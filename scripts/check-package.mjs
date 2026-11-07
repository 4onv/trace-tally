import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run with npm run check:package -- ARCHIVE.tgz');
const expected = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const archive = resolve(process.argv[2] || `4onv-trace-tally-${expected.version}.tgz`);
const scratch = await mkdtemp(join(tmpdir(), 'trace-tally-package-'));
try {
  await writeFile(join(scratch, 'package.json'), '{"private":true,"type":"module"}');
  execFileSync(process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive], { cwd: scratch, stdio: 'pipe', windowsHide: true });
  const installed = join(scratch, 'node_modules/@4onv/trace-tally');
  const bin = join(installed, 'bin/trace-tally.mjs');
  const run = args => execFileSync(process.execPath, [bin, ...args], { cwd: scratch, encoding: 'utf8', windowsHide: true });
  assert.equal(run(['--version']).trim(), expected.version);
  await access(join(scratch, 'node_modules/.bin', process.platform === 'win32' ? 'trace-tally.cmd' : 'trace-tally'));
  assert.match(run(['demo', '--out', 'demo']), /SYNTHETIC DEMO/);
  const comparison = JSON.parse(await readFile(join(scratch, 'demo/comparison.json'), 'utf8'));
  assert.equal(comparison.baseline.summary.calls, 8);
  assert.equal(comparison.candidate.summary.errors, 1);
  assert.match(await readFile(join(scratch, 'demo/report.html'), 'utf8'), /Synthetic/i);
  run(['report', 'demo/comparison.json', '--out', 'rebuilt']);
  assert.deepEqual(JSON.parse(await readFile(join(scratch, 'rebuilt/comparison.json'), 'utf8')), comparison);
  // Resolve public exports from a consumer outside the checkout. The sentinel must
  // remain in the operation result and never enter the recorder or shareable report.
  await writeFile(join(scratch, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRecorder } from '@4onv/trace-tally/recorder';
import { parseTrace, compareReceipts } from '@4onv/trace-tally';
import { renderReport } from '@4onv/trace-tally/report';
const sentinel = 'PRIVATE_PACKAGE_SENTINEL';
const recorder = createRecorder();
assert.equal(await recorder.run('read', async () => sentinel), sentinel);
const raw = recorder.toJSONL();
assert.ok(!raw.includes(sentinel));
const receipt = parseTrace(raw);
assert.equal(receipt.summary.calls, 1);
assert.equal(receipt.summary.successes, 1);
const html = renderReport(compareReceipts(receipt, receipt));
assert.ok(!html.includes(sentinel));
await writeFile('recorded.jsonl', raw);
`);
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: scratch, stdio: 'inherit', windowsHide: true });
  run(['inspect', 'recorded.jsonl', '--out', 'inspected']);
  const receipt = JSON.parse(await readFile(join(scratch, 'inspected/receipt.json'), 'utf8'));
  assert.equal(receipt.summary.calls, 1);
  assert.equal(receipt.summary.successes, 1);
  console.log('Offline archive install, installed CLI/demo/rebuild/inspect, and all public APIs passed.');
} finally {
  if (dirname(resolve(scratch)) !== resolve(tmpdir()) || !basename(scratch).startsWith('trace-tally-package-')) throw new Error('Unexpected cleanup path');
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
}
