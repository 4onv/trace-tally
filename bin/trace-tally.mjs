#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { constants } from 'node:fs';
import { open, readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrace, compareReceipts, LIMITS } from '../src/parser.mjs';
import { renderReport, projectComparison } from '../src/report.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const help = `TraceTally — Compare tool activity. Keep the conversation out.\n\nUsage:\n  trace-tally demo [--out .trace-tally/demo]\n  trace-tally compare BEFORE.jsonl AFTER.jsonl [--format auto|claude|events]\n  trace-tally inspect TRACE.jsonl [--format auto|claude|events]\n  trace-tally report comparison.json [--out DIRECTORY]\n\nOptions:\n  --out DIRECTORY         Write metadata-only JSON and, for comparisons, HTML\n  --format auto           Claude transcript or neutral tool events\n  --fail-on-more-errors   compare only: exit 1 when candidate error count increases\n  --help                 Show usage\n  --version              Show version\n\nNo network, model calls, dependencies, or automatic history scanning.\nExports omit original messages, tool names, inputs, outputs, paths, IDs, and dates.\nMetadata may still reveal activity patterns; review reports before sharing.\n`;

async function readBounded(file) {
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);
  const handle = await open(file, flags);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Trace input must be a regular file.');
    if (info.size > LIMITS.bytes) throw new Error('Input exceeds the 50 MiB limit.');
    const buffer = Buffer.allocUnsafe(info.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new Error('Trace changed size during read. Save a stable copy and try again.');
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new Error('Trace input must be valid UTF-8.');
    }
  } finally {
    await handle.close();
  }
}
async function protectInputs(out, names, inputs) {
  const inputPaths = await Promise.all(inputs.map(f => realpath(f)));
  await mkdir(out, { recursive: true });
  const outReal = await realpath(out);
  for (const name of names) {
    const target = path.join(outReal, name);
    let targetReal = target;
    try { targetReal = await realpath(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (inputPaths.some(input => process.platform === 'win32' ? input.toLowerCase() === targetReal.toLowerCase() : input === targetReal)) throw new Error('Output would overwrite an input file. Choose a separate --out directory.');
    // Refuse symlinks to unrelated destinations as well as to source files.
    if (targetReal !== target) throw new Error('Output file resolves outside its requested path. Choose a clean --out directory.');
  }
}
async function saveComparison(data, out, inputs) {
  const projected = projectComparison(data);
  const json = JSON.stringify(projected, null, 2) + '\n';
  const html = renderReport(projected);
  await protectInputs(out, ['comparison.json','report.html'], inputs);
  await writeFile(path.join(out, 'comparison.json'), json);
  await writeFile(path.join(out, 'report.html'), html);
  console.log(`Calls: ${projected.baseline.summary.calls} → ${projected.candidate.summary.calls}\nErrors: ${projected.baseline.summary.errors} → ${projected.candidate.summary.errors}\nReport: ${path.resolve(out, 'report.html')}\nFewer calls or errors alone do not establish better task quality.`);
  return projected;
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, version: { type: 'boolean' }, out: { type: 'string' }, format: { type: 'string' }, 'fail-on-more-errors': { type: 'boolean' }
  } });
  if (values.version) { console.log(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version); return; }
  if (values.help || !positionals.length) { console.log(help); return; }
  const [command, ...inputs] = positionals;
  const counts = { demo: 0, compare: 2, inspect: 1, report: 1 };
  if (!Object.hasOwn(counts, command) || inputs.length !== counts[command]) throw new Error('Invalid command or input count. See --help.');
  if (values.format && !['compare','inspect'].includes(command)) throw new Error('--format is only valid for compare and inspect.');
  if (values['fail-on-more-errors'] && command !== 'compare') throw new Error('--fail-on-more-errors is only valid for compare.');
  const format = values.format ?? 'auto';
  if (command === 'report') {
    let parsed;
    try { parsed = JSON.parse(await readBounded(inputs[0])); } catch (error) { if (error instanceof SyntaxError) throw new Error('Invalid comparison JSON.'); throw error; }
    await saveComparison(parsed, values.out ?? '.trace-tally/rebuilt', inputs); return;
  }
  if (command === 'inspect') {
    const receipt = parseTrace(await readBounded(inputs[0]), { format });
    const out = values.out ?? '.trace-tally/receipt';
    await protectInputs(out, ['receipt.json'], inputs);
    await writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(`${receipt.summary.calls} tool calls; ${receipt.summary.errors} errors; ${receipt.summary.pending} pending.\nReceipt: ${path.resolve(out, 'receipt.json')}`); return;
  }
  const demo = command === 'demo';
  const source = demo ? ['before.jsonl','after.jsonl'].map(f => path.join(root, 'examples', f)) : inputs;
  const receipts = [];
  for (const file of source) receipts.push(parseTrace(await readBounded(file), { format, demo }));
  if (demo) console.log('SYNTHETIC DEMO — fabricated tool events, not an agent benchmark.');
  const comparison = await saveComparison(compareReceipts(...receipts), values.out ?? (demo ? '.trace-tally/demo' : '.trace-tally/comparison'), source);
  if (values['fail-on-more-errors'] && comparison.delta.errors > 0) process.exitCode = 1;
}
main().catch(error => {
  const allowed = /^(Trace |Input exceeds |Invalid |Format must |Demo flag |No supported |Mixed or |Expected an object |--format |--fail-on-more-errors |Output |Comparison |Receipt |Event |Unknown |Unsupported |Expected )/;
  const message = allowed.test(error.message ?? '') ? error.message : ['ENOENT','EACCES','EPERM'].includes(error.code) ? `Could not read or write the selected file (${error.code}).` : 'Could not process the selected trace. Check its format and output directory.';
  console.error(`TraceTally: ${message}`); process.exitCode = 2;
});
