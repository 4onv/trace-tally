import { projectComparison } from './report.mjs';

export const CATEGORIES = Object.freeze(['shell', 'read', 'write', 'search', 'web', 'agent', 'other']);
export const LIMITS = Object.freeze({ bytes: 50 * 1024 * 1024, lineBytes: 1024 * 1024, records: 200000, events: 100000 });
const categoryMap = new Map([
  ['bash', 'shell'], ['shell', 'shell'], ['exec_command', 'shell'], ['terminal', 'shell'],
  ['read', 'read'], ['read_file', 'read'],
  ['write', 'write'], ['edit', 'write'], ['multiedit', 'write'], ['multi_edit', 'write'], ['write_file', 'write'], ['apply_patch', 'write'],
  ['glob', 'search'], ['grep', 'search'], ['search', 'search'],
  ['webfetch', 'web'], ['websearch', 'web'], ['web_fetch', 'web'], ['web_search', 'web'],
  ['task', 'agent'], ['agent', 'agent'], ['spawn_agent', 'agent']
]);
export const categorize = name => typeof name === 'string' ? categoryMap.get(name.toLowerCase()) ?? 'other' : 'other';

export function summarizeEvents(events) {
  const summary = { calls: events.length, successes: 0, errors: 0, pending: 0, unknown: 0, knownDurations: 0, totalKnownDurationMs: 0 };
  const categories = CATEGORIES.map(category => ({ category, calls: 0, errors: 0, knownDurationMs: 0 }));
  for (const event of events) {
    const group = categories.find(c => c.category === event.category);
    if (!group) throw new Error('Invalid tool category.');
    group.calls++;
    if (event.status === 'success') summary.successes++;
    else if (event.status === 'error') { summary.errors++; group.errors++; }
    else if (event.status === 'pending') summary.pending++;
    else if (event.status === 'unknown') summary.unknown++;
    else throw new Error('Invalid tool outcome.');
    if (event.durationMs !== null) {
      if (!Number.isFinite(event.durationMs) || event.durationMs < 0) throw new Error('Invalid tool duration.');
      summary.knownDurations++;
      summary.totalKnownDurationMs += event.durationMs;
      group.knownDurationMs += event.durationMs;
      if (summary.totalKnownDurationMs > Number.MAX_SAFE_INTEGER) throw new Error('Trace duration total exceeds the safe numeric limit.');
    }
  }
  return { summary, categories };
}

/** Read only tool structure. Raw contents, IDs, names, and timestamps never enter the returned receipt. */
export function parseTrace(text, { format = 'auto', demo = false } = {}) {
  if (typeof text !== 'string') throw new Error('Trace input must be UTF-8 text.');
  if (!['auto', 'claude', 'events'].includes(format)) throw new Error('Format must be auto, claude, or events.');
  if (Buffer.byteLength(text) > LIMITS.bytes) throw new Error('Trace exceeds the 50 MiB input limit.');
  if (typeof demo !== 'boolean') throw new Error('Demo flag must be a boolean.');
  const events = [], starts = new Map(), ended = new Set();
  const diagnostics = { ignoredRecords: 0, duplicateStarts: 0, duplicateEnds: 0, orphanEnds: 0, invalidTimings: 0 };
  let selected = format === 'auto' ? null : format;
  let recognized = 0, lineNumber = 0, recordCount = 0;
  const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 4096;
  const timestamp = value => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      const parsed = Date.parse(value);
      const day = Date.parse(value.slice(0, 10) + 'T00:00:00Z');
      const validDay = Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value.slice(0, 10);
      if (Number.isFinite(parsed) && validDay && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60) return parsed;
    }
    diagnostics.invalidTimings++; return null;
  };
  const start = (id, name, time) => {
    if (!validId(id) || typeof name !== 'string' || !name.length || name.length > 4096) throw new Error(`Invalid tool start at line ${lineNumber}.`);
    if (starts.has(id)) { diagnostics.duplicateStarts++; return; }
    if (events.length >= LIMITS.events) throw new Error('Trace exceeds the 100000 tool-call limit.');
    const event = { index: events.length + 1, category: categorize(name), status: 'pending', durationMs: null };
    starts.set(id, { event, time: timestamp(time) }); events.push(event);
  };
  const end = (id, status, time) => {
    if (!validId(id) || !['success','error','unknown'].includes(status)) throw new Error(`Invalid tool result at line ${lineNumber}.`);
    if (ended.has(id)) { diagnostics.duplicateEnds++; return; }
    if (!starts.has(id)) { diagnostics.orphanEnds++; return; }
    const { event, time: started } = starts.get(id);
    const finished = timestamp(time);
    event.status = status;
    if (started !== null && finished !== null) {
      if (finished >= started) event.durationMs = finished - started;
      else diagnostics.invalidTimings++;
    }
    ended.add(id);
  };
  let offset = 0;
  while (offset < text.length) {
    let boundary = text.indexOf('\n', offset); if (boundary < 0) boundary = text.length;
    let line = text.slice(offset, boundary); offset = boundary + 1; lineNumber++;
    if (lineNumber === 1) line = line.replace(/^\uFEFF/, '');
    if (Buffer.byteLength(line) > LIMITS.lineBytes) throw new Error(`Trace line ${lineNumber} exceeds the 1 MiB limit.`);
    if (!line.trim()) continue;
    if (++recordCount > LIMITS.records) throw new Error('Trace exceeds the 200000 record limit.');
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`Invalid JSON at line ${lineNumber}.`); }
    if (!record || Array.isArray(record) || typeof record !== 'object') throw new Error(`Expected an object at line ${lineNumber}.`);
    const neutral = ['tool_start','tool_end'].includes(record.type);
    const native = ['assistant','user'].includes(record.type) && record.message && (Array.isArray(record.message.content) || typeof record.message.content === 'string');
    const detected = neutral ? 'events' : native ? 'claude' : null;
    if (!detected) { diagnostics.ignoredRecords++; continue; }
    if (selected && selected !== detected) throw new Error(`Mixed or unexpected trace format at line ${lineNumber}; use one format per file.`);
    selected ??= detected; recognized++;
    if (detected === 'events') {
      if (record.type === 'tool_start') start(record.id, record.name, record.timestamp);
      else end(record.id, record.status, record.timestamp);
    } else if (Array.isArray(record.message.content)) {
      for (const block of record.message.content) {
        if (!block || typeof block !== 'object') continue;
        if (record.type === 'assistant' && block.type === 'tool_use') start(block.id, block.name, record.timestamp);
        if (record.type === 'user' && block.type === 'tool_result') {
          if (block.is_error !== undefined && typeof block.is_error !== 'boolean') throw new Error(`Invalid tool error flag at line ${lineNumber}.`);
          end(block.tool_use_id, block.is_error === true ? 'error' : 'success', record.timestamp);
        }
      }
    }
  }
  if (!recognized) throw new Error('No supported trace records found. Use Claude user/assistant JSONL or the neutral tool event format.');
  return { schemaVersion: 1, kind: 'trace-tally-receipt', format: selected, demo, ...summarizeEvents(events), events, diagnostics };
}

export function compareReceipts(baseline, candidate) {
  return projectComparison({ schemaVersion: 1, kind: 'trace-tally-comparison', demo: baseline.demo || candidate.demo, baseline, candidate,
    delta: { calls: candidate.summary.calls - baseline.summary.calls, errors: candidate.summary.errors - baseline.summary.errors, knownDurationMs: candidate.summary.totalKnownDurationMs - baseline.summary.totalKnownDurationMs } });
}
