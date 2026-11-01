import test from 'node:test';
import assert from 'node:assert/strict';
import { projectReceipt, projectComparison, renderReport } from '../src/report.mjs';

const diagnostics = () => ({ ignoredRecords: 0, duplicateStarts: 0, duplicateEnds: 0, orphanEnds: 0, invalidTimings: 0 });
const receipt = (events = [], demo = false) => ({ schemaVersion: 1, kind: 'trace-tally-receipt', format: 'events', demo, events, diagnostics: diagnostics() });
const event = (index, category = 'shell', status = 'success', durationMs = 100) => ({ index, category, status, durationMs });
const comparison = (baseline = receipt([event(1), event(2, 'read', 'error', null)]), candidate = receipt([event(1, 'read')]), demo = false) => ({ schemaVersion: 1, kind: 'trace-tally-comparison', demo, baseline, candidate });

test('projection discards all unrecognized content and recomputes aggregates', () => {
  const secret = 'PRIVATE_SENTINEL_a03f9_example';
  const input = comparison();
  input.prompt = secret; input.path = secret; input.delta = { calls: secret };
  input.baseline.summary = { calls: 99999, note: secret };
  input.baseline.categories = [{ category: secret, calls: 9999 }];
  input.baseline.sourcePath = secret;
  input.baseline.events[0].raw = secret;
  input.baseline.events[0].timestamp = secret;
  input.baseline.events[0].id = secret;
  input.baseline.diagnostics.errorText = secret;
  const projected = projectComparison(input);
  assert.ok(!JSON.stringify(projected).includes(secret));
  assert.equal(projected.baseline.summary.calls, 2);
  assert.equal(projected.baseline.summary.errors, 1);
  assert.deepEqual(projected.delta, { calls: -1, errors: -1, knownDurationMs: 0 });
  assert.equal(projected.baseline.categories.length, 7);
  assert.deepEqual(Object.keys(projected.baseline.events[0]), ['index', 'category', 'status', 'durationMs']);
});

test('report never embeds original input, raw IDs, paths, commands, or malicious extra fields', () => {
  const secret = 'sk_test_NOT_REAL_SECRET_92f9';
  const payload = '</script><img src=x onerror=alert(1)>';
  const input = comparison();
  input.baseline.events[0].command = secret;
  input.baseline.prompt = payload;
  input.candidate.metadata = { path: 'C:/private/customer.txt', raw: secret };
  const html = renderReport(input);
  for (const value of [secret, payload, 'C:/private/customer.txt']) assert.ok(!html.includes(value));
  assert.ok(!html.includes('application/json'));
  assert.match(html, /Content-Security-Policy/);
  assert.ok(!/<(?:script|link|img)[^>]+(?:src|href)=/i.test(html));
});

test('raw strings cannot masquerade as metadata', () => {
  for (const patch of [{ category: '<img src=x>' }, { status: 'secret-status' }, { durationMs: '12' }, { durationMs: Infinity }, { durationMs: -1 }, { index: 'private-id' }, { index: 0 }]) {
    const input = comparison(); Object.assign(input.baseline.events[0], patch);
    assert.throws(() => projectComparison(input), /Invalid/);
  }
  const input = comparison(); input.baseline.diagnostics.orphanEnds = 'secret';
  assert.throws(() => renderReport(input), /Invalid/);
});

test('schemas and enum formats are validated rather than rendered', () => {
  for (const input of [null, [], { schemaVersion: 2 }, { ...comparison(), demo: 'false' }]) assert.throws(() => projectComparison(input));
  const input = comparison(); input.baseline.format = 'private-provider';
  assert.throws(() => projectComparison(input), /format/);
  input.baseline.format = 'events'; input.baseline.events = [null];
  assert.throws(() => projectComparison(input), /Invalid event/);
});

test('synthetic labeling cannot be removed at the outer comparison level', () => {
  const input = comparison(receipt([event(1)], true), receipt([event(1)]), false);
  const projected = projectComparison(input);
  assert.equal(projected.demo, true);
  const html = renderReport(input);
  assert.match(html, /SYNTHETIC DEMO/);
  assert.match(html, /not measured agent performance/);
});

test('missing timing remains unknown; zero elapsed duration remains measured', () => {
  const a = receipt([event(1, 'shell', 'pending', null)]);
  const b = receipt([event(1, 'read', 'success', 0)]);
  const projected = projectComparison(comparison(a, b));
  assert.equal(projected.baseline.summary.knownDurations, 0);
  assert.equal(projected.candidate.summary.knownDurations, 1);
  const html = renderReport(comparison(a, b));
  assert.match(html, /Not reported/);
  assert.match(html, /Unknown/);
  assert.match(html, /0 ms/);
  assert.match(html, /Missing timing is unknown, not zero/);
});

test('summary records outcomes independently and only sums known durations', () => {
  const projected = projectReceipt(receipt([event(1, 'read', 'success', 1.25), event(9, 'write', 'error', 2.5), event(20, 'other', 'unknown', null), event(30, 'agent', 'pending', null)]));
  assert.deepEqual(projected.summary, { calls: 4, successes: 1, errors: 1, pending: 1, unknown: 1, knownDurations: 2, totalKnownDurationMs: 3.75 });
  assert.deepEqual(projected.events.map(e => e.index), [1, 2, 3, 4]);
  assert.equal(projected.categories.find(c => c.category === 'write').errors, 1);
});

test('numeric metadata cannot overflow into invalid chart values', () => {
  const input = comparison(receipt([event(1, 'shell', 'success', Number.MAX_SAFE_INTEGER), event(2, 'shell', 'success', 1)]));
  assert.throws(() => renderReport(input), /total duration/);
});

test('empty runs produce useful zero activity with unknown timing', () => {
  const html = renderReport(comparison(receipt(), receipt()));
  assert.match(html, /0 of 0 calls shown/);
  assert.match(html, /No calls match this filter/);
  assert.ok(!/NaN|Infinity/.test(html));
});

test('report exposes filters and honestly describes comparison boundaries', () => {
  const html = renderReport(comparison());
  assert.match(html, /aria-label="Filter calls"/);
  for (const filter of ['all', 'error', 'pending', 'unknown']) assert.ok(html.includes(`data-filter="${filter}"`));
  assert.match(html, /Rows are not semantic matches between runs/);
  assert.match(html, /not wall-clock runtime/);
  assert.match(html, /Metadata itself can reveal activity patterns/);
  assert.match(html, /do not prove better task quality/);
});
