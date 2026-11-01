// Synthetic in-memory operations and fabricated timestamps, not an agent benchmark.
// Run: node examples/record-tools.mjs > sample.jsonl
// Then: node bin/trace-tally.mjs inspect sample.jsonl --format events
import { createRecorder } from '../src/recorder.mjs';

process.stderr.write('TraceTally synthetic example: fabricated operations and timestamps, not an agent benchmark.\n');
let elapsed = Date.parse('2026-01-01T00:00:00Z');
const recorder = createRecorder({ clock: () => new Date(elapsed += 125) });
const sample = { privateText: 'SYNTHETIC_PRIVATE_CONTENT' };

await recorder.run('read', () => sample);
await recorder.run('search', async () => sample.privateText.includes('PRIVATE'));
try {
  await recorder.run('shell', () => { throw new Error('SYNTHETIC_PRIVATE_ERROR'); });
} catch {
  // Application code handles its original failure; no exception text enters the log.
}

process.stdout.write(recorder.toJSONL());
