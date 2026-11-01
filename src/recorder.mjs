const TOOL_NAMES = Object.freeze({ shell: 'Bash', read: 'Read', write: 'Write', search: 'Grep', web: 'WebFetch', agent: 'Agent', other: 'Other' });

function readTimestamp(clock) {
  try {
    const value = clock();
    // Call native methods so a Date subclass cannot serialize an arbitrary string.
    const timestamp = Date.prototype.toISOString.call(value);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp)) throw new Error();
    return timestamp;
  } catch {
    throw new Error('Recorder clock must return a valid Date with a four-digit year.');
  }
}

/**
 * Record an explicitly wrapped operation without capturing its arguments,
 * return value, exception, source, or custom labels. Keep one recorder per run.
 * The raw neutral log includes generated call IDs and absolute timestamps;
 * inspect/compare project those into the smaller shareable receipt format.
 */
export function createRecorder(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new Error('Recorder options must be an object.');
  const { clock = () => new Date(), maxCalls = 100000 } = options;
  if (typeof clock !== 'function') throw new Error('Recorder clock must be a function.');
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 100000) throw new Error('Recorder maxCalls must be an integer from 1 to 100000.');
  const events = [];
  let calls = 0, pending = 0;

  async function run(category, operation) {
    if (typeof category !== 'string' || !Object.hasOwn(TOOL_NAMES, category)) throw new Error('Recorder category must be shell, read, write, search, web, agent, or other.');
    if (typeof operation !== 'function') throw new Error('Recorder operation must be a function.');
    if (calls >= maxCalls) throw new Error('Recorder call limit reached; create another recorder for a new run.');
    const timestamp = readTimestamp(clock);
    const id = `call-${++calls}`;
    events.push({ type: 'tool_start', id, name: TOOL_NAMES[category], timestamp });
    pending++;
    let status = 'success';
    try {
      return await operation();
    } catch (error) {
      status = 'error';
      throw error;
    } finally {
      const end = { type: 'tool_end', id, status };
      // Instrumentation must not replace a result or hide the original failure.
      // An invalid completion clock means unknown timing, not an invented zero.
      try { end.timestamp = readTimestamp(clock); } catch { /* leave timing unknown */ }
      events.push(end);
      pending--;
    }
  }

  return Object.freeze({
    run,
    toJSONL() { return events.length ? events.map(event => JSON.stringify(event)).join('\n') + '\n' : ''; },
    get size() { return calls; },
    get pending() { return pending; }
  });
}
