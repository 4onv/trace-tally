# Record tool activity

`createRecorder` wraps JavaScript operations and produces TraceTally's neutral JSONL format. It has no network access, filesystem access, or external dependencies. You choose when and where to save its output.

```js
import { createRecorder } from '../src/recorder.mjs';

const recorder = createRecorder({ maxCalls: 1000 });
const answer = await recorder.run('read', () => 42);
console.log(answer); // 42
const jsonl = recorder.toJSONL();
```

An installed package exposes the same API through `@4onv/trace-tally/recorder`. The package is not published to npm; the relative import above works from this repository's `docs` directory.

## API

`createRecorder({ clock, maxCalls })` returns an immutable object with:

- `run(category, operation)`: returns a promise for the operation's original result. A thrown value or rejected promise is rethrown unchanged after recording an error outcome.
- `toJSONL()`: serializes the captured start/end records. It does not clear them.
- `size`: number of started calls.
- `pending`: number of calls still running.

`category` must be one of `shell`, `read`, `write`, `search`, `web`, `agent`, or `other`. Arbitrary tool names and labels are rejected. Calls can finish in a different order from their starts; generated IDs correlate them internally. Calling `toJSONL()` while operations are pending yields a partial recording that the parser reports honestly as pending.

The default `maxCalls` is 100000; configure an integer from 1 to 100000. Once reached, new calls reject before executing their operation. This bounds retained records but is not a general memory bound on operations themselves. Start a new recorder for the next run. Recorded operations are not sandboxed or cancelled by this library.

The default `clock` returns `new Date()`. A custom clock must return a valid `Date`. A clock failure before a start rejects without running the operation. A failure at completion omits that timestamp so it cannot mask the operation's result or original error. The parser treats missing or reversed time as unknown. Recorded durations use wall-clock observations and can be affected by clock adjustments.

## Data boundary

No arguments, result bodies, exceptions, stack traces, source code, or custom labels are saved. The raw log includes only fixed tool names, generated IDs, timestamps when available, and outcome values. The comparison/inspection projection drops the generated IDs and absolute timestamps. Counts and timings can still disclose activity patterns; metadata is not guaranteed anonymous.

`node examples/record-tools.mjs` prints synthetic JSONL to stdout and a demo warning to stderr. It runs no external tools and performs no network or filesystem operations. Its examples illustrate instrumentation, not measured agent performance.
