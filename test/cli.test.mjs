import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrace } from '../src/parser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function cli(args, cwd = root) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [path.join(root, 'bin/trace-tally.mjs'), ...args], { cwd, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.ifError(result.error); return result;
}

test('CLI demo, import, comparison, and report round-trip stay content-free', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trace-tally-cli-'));
  try {
    const demo = cli(['demo', '--out', directory]);
    assert.equal(demo.status, 0, demo.stderr); assert.match(demo.stdout, /SYNTHETIC DEMO/);
    const json = await readFile(path.join(directory, 'comparison.json'), 'utf8');
    const report = JSON.parse(json);
    assert.equal(report.baseline.summary.calls, 8); assert.equal(report.candidate.summary.errors, 1);
    const html = await readFile(path.join(directory, 'report.html'), 'utf8');
    for (const content of [json, html]) for (const secret of ['SENTINEL', 'PRIVATE', 'tool_use_id', 'timestamp', 'api_key']) {
      // Fixed prose can describe excluded timestamps, but no source fields/sentinels appear in JSON.
      if (content === html && secret === 'timestamp') continue;
      assert.ok(!content.includes(secret), `Unexpected source field ${secret}`);
    }
    const rebuilt = path.join(directory, 'rebuilt');
    const result = cli(['report', path.join(directory, 'comparison.json'), '--out', rebuilt]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(path.join(rebuilt, 'comparison.json'), 'utf8')), report);
    const before = path.join(root, 'examples/before.jsonl'), after = path.join(root, 'examples/after.jsonl');
    const passing = cli(['compare', before, after, '--fail-on-more-errors', '--out', path.join(directory, 'pass')]);
    assert.equal(passing.status, 0, passing.stderr);
    const failing = cli(['compare', after, before, '--fail-on-more-errors', '--out', path.join(directory, 'fail')]);
    assert.equal(failing.status, 1, failing.stderr);
    const inspect = cli(['inspect', before, '--out', path.join(directory, 'inspect')]);
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.equal(JSON.parse(await readFile(path.join(directory, 'inspect/receipt.json'), 'utf8')).summary.calls, 8);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
});

test('CLI refuses source overwrites and malformed traces without printing their contents', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trace-tally-guard-'));
  try {
    const source = path.join(directory, 'receipt.json');
    const text = '{"type":"tool_start","id":"x","name":"Read"}\n';
    await writeFile(source, text);
    const blocked = cli(['inspect', source, '--out', directory]);
    assert.equal(blocked.status, 2); assert.match(blocked.stderr, /overwrite/);
    assert.equal(await readFile(source, 'utf8'), text);
    await writeFile(source, '{SUPER_PRIVATE_SENTINEL');
    const malformed = cli(['inspect', source, '--out', path.join(directory, 'invalid')]);
    assert.equal(malformed.status, 2); assert.match(malformed.stderr, /line 1/);
    assert.ok(!malformed.stderr.includes('SUPER_PRIVATE_SENTINEL'));
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
});

test('version/help and invalid command flags have predictable exit status', async () => {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(cli(['--version']).stdout.trim(), version);
  assert.match(cli(['--help']).stdout, /Usage:/);
  assert.equal(cli(['demo', '--format', 'claude']).status, 2);
  assert.equal(cli(['inspect']).status, 2);
});

test('calendar-normalized invalid dates and non-ISO times never become durations', () => {
  for (const bad of ['2026-02-30T01:00:00Z','2026-11-01T24:00:00Z','2026-11-01T01:60:00Z']) {
    const trace = [{ type: 'tool_start', id:'x', name:'Read', timestamp:bad }, { type:'tool_end', id:'x', status:'success', timestamp:'2026-12-01T00:00:00Z' }].map(JSON.stringify).join('\n');
    const result = parseTrace(trace);
    assert.equal(result.events[0].durationMs, null);
    assert.equal(result.diagnostics.invalidTimings, 1);
  }
});
