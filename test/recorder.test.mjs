import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '@4onv/trace-tally/recorder';
import { parseTrace } from '../src/parser.mjs';

function tickingClock() {
  let milliseconds = Date.parse('2026-01-01T00:00:00Z');
  return () => new Date(milliseconds += 100);
}

test('wrapped synchronous and asynchronous operations return their exact values', async () => {
  const recorder = createRecorder({ clock: tickingClock() });
  const result = { private: 'SYNTHETIC_PRIVATE_RESULT', nested: ['not serialized'] };
  assert.equal(await recorder.run('read', () => result), result);
  assert.equal(await recorder.run('search', async () => undefined), undefined);
  const receipt = parseTrace(recorder.toJSONL());
  assert.equal(receipt.summary.calls, 2);
  assert.equal(receipt.summary.successes, 2);
  assert.equal(receipt.summary.totalKnownDurationMs, 200);
  assert.equal(recorder.size, 2);
  assert.equal(recorder.pending, 0);
});

test('recording never serializes arguments, returned objects, thrown errors, or custom labels', async () => {
  const recorder = createRecorder({ clock: tickingClock(), secret: 'SYNTHETIC_PRIVATE_OPTION' });
  const input = 'SYNTHETIC_PRIVATE_INPUT';
  const returned = { secret: 'SYNTHETIC_PRIVATE_RETURN', toJSON() { throw new Error('must not serialize'); } };
  const original = new Error('SYNTHETIC_PRIVATE_ERROR');
  original.path = '/SYNTHETIC_PRIVATE_PATH';
  await recorder.run('shell', () => { assert.equal(input, 'SYNTHETIC_PRIVATE_INPUT'); return returned; });
  await assert.rejects(recorder.run('other', async () => { throw original; }), error => error === original);
  const text = recorder.toJSONL();
  assert.ok(!text.includes('SYNTHETIC_PRIVATE'));
  const entries = text.trim().split('\n').map(JSON.parse);
  assert.deepEqual(Object.keys(entries[0]), ['type', 'id', 'name', 'timestamp']);
  assert.deepEqual(Object.keys(entries[1]), ['type', 'id', 'status', 'timestamp']);
  assert.equal(parseTrace(text).summary.errors, 1);
});

test('all accepted categories round-trip to the same fixed category', async () => {
  const recorder = createRecorder({ clock: tickingClock() });
  const categories = ['shell', 'read', 'write', 'search', 'web', 'agent', 'other'];
  for (const category of categories) await recorder.run(category, () => null);
  assert.deepEqual(parseTrace(recorder.toJSONL()).events.map(event => event.category), categories);
});

test('out-of-order concurrent completions correlate by generated IDs', async () => {
  const recorder = createRecorder({ clock: tickingClock() });
  let finishFirst, failSecond;
  const original = new Error('private failure');
  const first = recorder.run('read', () => new Promise(resolve => { finishFirst = resolve; }));
  const second = recorder.run('web', () => new Promise((_, reject) => { failSecond = reject; }));
  assert.equal(recorder.pending, 2);
  const during = parseTrace(recorder.toJSONL());
  assert.equal(during.summary.pending, 2);
  failSecond(original);
  await assert.rejects(second, error => error === original);
  finishFirst('value');
  assert.equal(await first, 'value');
  const receipt = parseTrace(recorder.toJSONL());
  assert.deepEqual(receipt.events.map(event => event.status), ['success', 'error']);
  assert.deepEqual(receipt.events.map(event => event.durationMs), [300, 100]);
  assert.equal(recorder.pending, 0);
});

test('synchronous throws and primitive promise rejections preserve identity', async () => {
  const recorder = createRecorder({ clock: tickingClock() });
  const original = { secret: 'do not serialize' };
  await assert.rejects(recorder.run('write', () => { throw original; }), error => error === original);
  try { await recorder.run('agent', () => Promise.reject(undefined)); assert.fail('expected rejection'); }
  catch (error) { assert.equal(error, undefined); }
  assert.equal(parseTrace(recorder.toJSONL()).summary.errors, 2);
});

test('invalid categories and callbacks fail before recording or running anything', async () => {
  const recorder = createRecorder({ clock: tickingClock() });
  let invoked = false;
  for (const category of ['SYNTHETIC_PRIVATE_NAME', '__proto__', 'constructor', '', null, new String('read')]) {
    await assert.rejects(recorder.run(category, () => { invoked = true; }), error => {
      assert.ok(!error.message.includes('SYNTHETIC_PRIVATE_NAME'));
      return /category/.test(error.message);
    });
  }
  await assert.rejects(recorder.run('read', 'not a function'), /operation/);
  assert.equal(invoked, false);
  assert.equal(recorder.size, 0);
  assert.equal(recorder.toJSONL(), '');
});

test('bounded capacity counts started calls, including pending and failed calls', async () => {
  const recorder = createRecorder({ clock: tickingClock(), maxCalls: 1 });
  let finish;
  const running = recorder.run('read', () => new Promise(resolve => { finish = resolve; }));
  let invoked = false;
  await assert.rejects(recorder.run('write', () => { invoked = true; }), /limit/);
  assert.equal(invoked, false);
  finish(); await running;
  await assert.rejects(recorder.run('other', () => {}), /limit/);
  assert.equal(recorder.size, 1);
  assert.equal(Object.isFrozen(recorder), true);
});

test('invalid initial clock rejects without invoking the operation or leaking clock errors', async () => {
  for (const clock of [() => new Date(NaN), () => 'SYNTHETIC_PRIVATE_DATE', () => { throw new Error('SYNTHETIC_PRIVATE_CLOCK'); }, () => new Date('10000-01-01')]) {
    const recorder = createRecorder({ clock });
    let invoked = false;
    await assert.rejects(recorder.run('read', () => { invoked = true; }), error => {
      assert.match(error.message, /clock must return/);
      assert.ok(!error.message.includes('SYNTHETIC_PRIVATE'));
      return true;
    });
    assert.equal(invoked, false);
    assert.equal(recorder.size, 0);
    assert.equal(recorder.toJSONL(), '');
  }
});

test('completion clock failure leaves timing unknown and preserves success or original failure', async () => {
  for (const fails of [false, true]) {
    let reads = 0;
    const recorder = createRecorder({ clock: () => ++reads === 1 ? new Date('2026-01-01T00:00:00Z') : (() => { throw new Error('private clock error'); })() });
    const original = new Error('private operation error');
    const promise = recorder.run('shell', () => { if (fails) throw original; return 42; });
    if (fails) await assert.rejects(promise, error => error === original);
    else assert.equal(await promise, 42);
    const receipt = parseTrace(recorder.toJSONL());
    assert.equal(receipt.events[0].durationMs, null);
    assert.equal(receipt.events[0].status, fails ? 'error' : 'success');
    assert.equal(recorder.pending, 0);
  }
});

test('Date subclass serialization overrides cannot inject source text', async () => {
  class CustomDate extends Date { toISOString() { return 'SYNTHETIC_PRIVATE_INJECTION'; } }
  const recorder = createRecorder({ clock: () => new CustomDate('2026-01-01T00:00:00Z') });
  await recorder.run('read', () => null);
  assert.ok(!recorder.toJSONL().includes('SYNTHETIC_PRIVATE_INJECTION'));
  assert.equal(parseTrace(recorder.toJSONL()).events[0].durationMs, 0);
});

test('invalid recorder configuration is rejected predictably', () => {
  for (const options of [null, [], 'secret']) assert.throws(() => createRecorder(options), /options/);
  for (const maxCalls of [0, -1, 100001, 1.5, '10', Infinity, NaN]) assert.throws(() => createRecorder({ maxCalls }), /maxCalls/);
  assert.throws(() => createRecorder({ clock: null }), /clock must be a function/);
});
