import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTrace, compareReceipts, LIMITS } from '../src/parser.mjs';

const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const start = (id, name = 'Bash', timestamp) => ({ type: 'tool_start', id, name, ...(timestamp ? { timestamp } : {}) });
const end = (id, status = 'success', timestamp) => ({ type: 'tool_end', id, status, ...(timestamp ? { timestamp } : {}) });
const category = (receipt, name) => receipt.categories.find(row => row.category === name);

test('synthetic fixtures yield known comparison totals without exporting transcript fields', async () => {
  const before = parseTrace(await readFile(new URL('../examples/before.jsonl', import.meta.url), 'utf8'), { demo: true });
  const after = parseTrace(await readFile(new URL('../examples/after.jsonl', import.meta.url), 'utf8'), { demo: true });
  assert.deepEqual(before.summary, { calls: 8, successes: 5, errors: 3, pending: 0, unknown: 0, knownDurations: 8, totalKnownDurationMs: 9140 });
  assert.deepEqual(after.summary, { calls: 5, successes: 4, errors: 1, pending: 0, unknown: 0, knownDurations: 5, totalKnownDurationMs: 3760 });
  const comparison = compareReceipts(before, after);
  assert.equal(comparison.kind, 'trace-tally-comparison');
  assert.equal(comparison.demo, true);
  assert.deepEqual(comparison.delta, { calls: -3, errors: -2, knownDurationMs: -5380 });
  const output = JSON.stringify(comparison);
  for (const forbidden of ['SYNTHETIC_PRIVATE', 'synthetic-before', 'synthetic-after', '2026-01-01', 'arguments', 'credential', 'Bash', 'WebFetch']) assert.ok(!output.includes(forbidden), forbidden);
});

test('Claude adapter correlates tool results while discarding prompt, source, and session metadata', async () => {
  const receipt = parseTrace(await readFile(new URL('../examples/claude-small.jsonl', import.meta.url), 'utf8'));
  assert.equal(receipt.format, 'claude');
  assert.equal(receipt.summary.calls, 2);
  assert.equal(receipt.summary.successes, 1);
  assert.equal(receipt.summary.errors, 1);
  assert.equal(receipt.summary.totalKnownDurationMs, 1750);
  assert.deepEqual(receipt.events.map(row => [row.category, row.status, row.durationMs]), [['read', 'success', 250], ['shell', 'error', 1500]]);
  const output = JSON.stringify(receipt);
  assert.ok(!output.includes('SYNTHETIC_PRIVATE'));
  assert.ok(!output.includes('2026-01-01'));
  assert.ok(!output.includes('cwd'));
  assert.ok(!output.includes('sessionId'));
});

test('unknown tool names are replaced with other rather than echoed or hashed', () => {
  const receipt = parseTrace(jsonl([start('private-id', 'SECRET_INTERNAL_CUSTOMER_API'), end('private-id')]));
  assert.equal(receipt.events[0].category, 'other');
  assert.equal(category(receipt, 'other').calls, 1);
  assert.ok(!JSON.stringify(receipt).includes('SECRET_INTERNAL_CUSTOMER_API'));
  assert.ok(!JSON.stringify(receipt).includes('private-id'));
});

test('fixed categories map supported names without treating arbitrary substrings as known tools', () => {
  const names = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'SENSITIVE_Bash_COMMAND'];
  const receipt = parseTrace(jsonl(names.flatMap((name, i) => [start(`id-${i}`, name), end(`id-${i}`)])));
  assert.deepEqual(receipt.events.map(row => row.category), ['shell', 'read', 'write', 'write', 'search', 'search', 'web', 'web', 'agent', 'agent', 'other']);
});

test('pairing uses IDs internally rather than result position', () => {
  const receipt = parseTrace(jsonl([start('a', 'Read'), start('b', 'Edit'), end('b', 'error'), end('a', 'success')]));
  assert.deepEqual(receipt.events.map(row => [row.index, row.category, row.status]), [[1, 'read', 'success'], [2, 'write', 'error']]);
  assert.ok(!Object.hasOwn(receipt.events[0], 'id'));
});

test('duplicate starts and ends do not inflate calls or overwrite the first outcome', () => {
  const receipt = parseTrace(jsonl([start('a', 'Read'), start('a', 'Bash'), end('a', 'error'), end('a', 'success')]));
  assert.equal(receipt.summary.calls, 1);
  assert.equal(receipt.summary.errors, 1);
  assert.equal(receipt.events[0].category, 'read');
  assert.equal(receipt.diagnostics.duplicateStarts, 1);
  assert.equal(receipt.diagnostics.duplicateEnds, 1);
});

test('orphan results and unfinished calls stay visible without invented successes', () => {
  const receipt = parseTrace(jsonl([end('never-started', 'success'), start('unfinished', 'Task')]));
  assert.equal(receipt.summary.calls, 1);
  assert.equal(receipt.summary.pending, 1);
  assert.equal(receipt.summary.successes, 0);
  assert.equal(receipt.events[0].durationMs, null);
  assert.equal(receipt.diagnostics.orphanEnds, 1);
});

test('explicit unknown outcomes are not silently classified as successes', () => {
  const receipt = parseTrace(jsonl([start('a'), end('a', 'unknown')]));
  assert.equal(receipt.summary.unknown, 1);
  assert.equal(receipt.summary.successes, 0);
  assert.equal(receipt.events[0].status, 'unknown');
});

test('missing, invalid, and reversed timestamps never become fabricated zero durations', () => {
  const receipt = parseTrace(jsonl([
    start('missing'), end('missing'),
    start('invalid', 'Read', 'SYNTHETIC_PRIVATE_DATE'), end('invalid', 'success', '2026-01-01T00:00:00Z'),
    start('reversed', 'Read', '2026-01-01T00:00:02Z'), end('reversed', 'success', '2026-01-01T00:00:01Z'),
    start('valid', 'Read', '2026-01-01T00:00:01Z'), end('valid', 'success', '2026-01-01T00:00:01Z')
  ]));
  assert.deepEqual(receipt.events.map(row => row.durationMs), [null, null, null, 0]);
  assert.equal(receipt.summary.knownDurations, 1);
  assert.equal(receipt.summary.totalKnownDurationMs, 0);
  assert.ok(receipt.diagnostics.invalidTimings >= 2);
  assert.ok(!JSON.stringify(receipt).includes('SYNTHETIC_PRIVATE_DATE'));
});

test('JSON parse failures reveal line numbers but not source content', () => {
  const input = JSON.stringify(start('a')) + '\n{"SYNTHETIC_PRIVATE_BROKEN_JSON"\n';
  assert.throws(() => parseTrace(input), error => /line 2/i.test(error.message) && !error.message.includes('SYNTHETIC_PRIVATE'));
});

test('unrelated JSON is not accepted as an empty successful trace', () => {
  assert.throws(() => parseTrace(jsonl([{ private: 'SYNTHETIC_PRIVATE_UNRELATED' }])));
});

test('valid Claude messages with no tools produce an honest zero-call receipt', () => {
  const receipt = parseTrace(jsonl([{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'SYNTHETIC_PRIVATE_TEXT_ONLY' }] } }]), { format: 'claude' });
  assert.equal(receipt.summary.calls, 0);
  assert.deepEqual(receipt.events, []);
  assert.ok(!JSON.stringify(receipt).includes('SYNTHETIC_PRIVATE_TEXT_ONLY'));
});

test('ignored content records cannot inject arbitrary export properties', () => {
  const receipt = parseTrace(jsonl([
    { ...start('a'), category: 'SYNTHETIC_PRIVATE_CATEGORY', summary: { credential: 'SYNTHETIC_PRIVATE_SECRET' }, source: '/SYNTHETIC_PRIVATE_PATH' },
    { ...end('a'), message: 'SYNTHETIC_PRIVATE_MESSAGE', filename: '/SYNTHETIC_PRIVATE_PATH', debug: { token: 'SYNTHETIC_PRIVATE_TOKEN' } },
    { type: 'SYNTHETIC_PRIVATE_RECORD_TYPE', value: 'SYNTHETIC_PRIVATE_VALUE' }
  ]));
  assert.equal(receipt.summary.calls, 1);
  assert.ok(receipt.diagnostics.ignoredRecords >= 1);
  assert.ok(!JSON.stringify(receipt).includes('SYNTHETIC_PRIVATE'));
  assert.deepEqual(Object.keys(receipt.events[0]).sort(), ['category', 'durationMs', 'index', 'status']);
});

test('demo label is not inferred from source fields and survives if either receipt is synthetic', () => {
  const text = jsonl([{ ...start('a'), demo: true }, end('a')]);
  const ordinary = parseTrace(text);
  const demo = parseTrace(text, { demo: true });
  assert.equal(ordinary.demo, false);
  assert.equal(compareReceipts(demo, ordinary).demo, true);
  assert.equal(compareReceipts(ordinary, demo).demo, true);
  assert.equal(compareReceipts(demo, demo).demo, true);
});

test('auto detection refuses mixed trace formats instead of silently dropping supported events', () => {
  const text = jsonl([start('a'), { type: 'assistant', message: { content: [{ type: 'text', text: 'SYNTHETIC_PRIVATE_NATIVE_TEXT' }] } }]);
  assert.throws(() => parseTrace(text), error => /format.*line 2|line 2.*format/i.test(error.message) && !error.message.includes('SYNTHETIC_PRIVATE'));
  assert.throws(() => parseTrace(jsonl([start('a')]), { format: 'claude' }), /format/i);
  assert.throws(() => parseTrace(jsonl([start('a')]), { format: 'SYNTHETIC_PRIVATE_FORMAT' }), error => /format/i.test(error.message) && !error.message.includes('SYNTHETIC_PRIVATE'));
});

test('line and file limits are measured in bytes and enforced before parsing oversized content', () => {
  const oversizedLine = JSON.stringify({ type: 'note', text: '☃'.repeat(Math.ceil(LIMITS.lineBytes / 3)) });
  assert.ok(oversizedLine.length < LIMITS.lineBytes);
  assert.throws(() => parseTrace(oversizedLine), /line 1.*1 MiB/i);
  assert.throws(() => parseTrace(' '.repeat(LIMITS.bytes + 1)), /50 MiB/i);
});

test('record and tool-call limits bound structurally valid traces', () => {
  assert.throws(() => parseTrace('{}\n'.repeat(LIMITS.records + 1)), /200000 record/i);
  const text = Array.from({ length: LIMITS.events + 1 }, (_, index) => JSON.stringify(start(String(index)))).join('\n');
  assert.throws(() => parseTrace(text), /100000 tool-call/i);
});

test('prototype-shaped IDs pair normally without changing export structure', () => {
  const receipt = parseTrace(jsonl([start('__proto__', 'Read'), start('constructor', 'Edit'), end('constructor', 'error'), end('__proto__')]));
  assert.equal(receipt.summary.calls, 2);
  assert.equal(receipt.summary.successes, 1);
  assert.equal(receipt.summary.errors, 1);
  assert.equal(receipt.events[0].category, 'read');
  assert.ok(!JSON.stringify(receipt).includes('__proto__'));
  assert.ok(!JSON.stringify(receipt).includes('constructor'));
});

test('tool-like objects inside raw inputs and result bodies are never traversed', () => {
  const nestedTool = { type: 'tool_use', id: 'SYNTHETIC_PRIVATE_NESTED_ID', name: 'Bash' };
  const receipt = parseTrace(jsonl([
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'real', name: 'Read', input: nestedTool }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'real', content: [nestedTool] }] } }
  ]));
  assert.equal(receipt.summary.calls, 1);
  assert.equal(receipt.events[0].category, 'read');
  assert.ok(!JSON.stringify(receipt).includes('SYNTHETIC_PRIVATE'));
});
