# Input format and CLI reference

TraceTally v0.1 accepts newline-delimited JSON: one JSON object per line. Supply an explicit file path. It does not discover or recursively scan agent data directories.

## Commands

Run commands from the repository folder with Node.js 22 or newer.

| Command | Default output | Files written |
| --- | --- | --- |
| `node bin/trace-tally.mjs demo` | `.trace-tally/demo` | Synthetic comparison and HTML report |
| `node bin/trace-tally.mjs compare BEFORE.jsonl AFTER.jsonl` | `.trace-tally/comparison` | `comparison.json`, `report.html` |
| `node bin/trace-tally.mjs inspect TRACE.jsonl` | `.trace-tally/receipt` | `receipt.json` |
| `node bin/trace-tally.mjs report comparison.json` | `.trace-tally/rebuilt` | `comparison.json`, `report.html` |

`--out DIRECTORY` selects a different output location. `compare` and `inspect` accept `--format auto`, `--format claude`, or `--format events`. The default is `auto`. In auto mode, each file selects its format from its recognized records; mixing the two formats within one file is an error.

`--fail-on-more-errors` applies only to `compare`. It fails the command when the candidate's recorded error-call count exceeds the baseline's. A run with more work may naturally have more errors; this gate deliberately does not normalize by the number of calls.

| Exit code | Meaning |
| --- | --- |
| `0` | Command completed successfully |
| `1` | The requested more-errors comparison gate failed |
| `2` | Invalid input, invalid options, or a runtime error |

There is no dependency installation, agent execution, paid API request, or model invocation in these commands.

## Neutral event schema

Use `--format events` for an adapter that produces the following records:

```jsonl
{"type":"tool_start","id":"c1","name":"Bash","timestamp":"2026-01-01T00:00:00Z"}
{"type":"tool_end","id":"c1","status":"success","timestamp":"2026-01-01T00:00:02Z"}
{"type":"tool_start","id":"c2","name":"Read"}
{"type":"tool_end","id":"c2","status":"unknown"}
```

The `id` links a start and end within that file. Use a distinct ID for each call. The end status is `success`, `error`, or `unknown`. Timestamps are optional; use ISO 8601 strings with a timezone when supplying them.

In this example, the shell call has a known duration of two seconds. The read call has no timing information and an explicitly unknown outcome. The strings `c1`, `c2`, `Bash`, `Read`, and the absolute timestamps are inputs to the projection, not public labels copied into the export.

The neutral schema is not a claim that all source formats carry these fields. An adapter should preserve uncertainty and must not invent success, timing, or a result that was never observed.

## Claude Code JSONL

Use `--format claude` for supported native user/assistant records. Tool starts appear in an assistant message's `content` array as `tool_use`; results appear in a user message's `content` array as `tool_result`.

```jsonl
{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","message":{"content":[{"type":"tool_use","id":"call-1","name":"Bash","input":{"command":"echo example"}}]}}
{"type":"user","timestamp":"2026-01-01T00:00:02Z","message":{"content":[{"type":"tool_result","tool_use_id":"call-1","is_error":false,"content":"example"}]}}
```

The example command and result body are shown to illustrate the input format. Neither belongs in the exported receipt. Message text, thinking blocks, tool arguments, and output content are not report content.

A native `tool_result` with `is_error: true` records an error. `is_error: false` or an omitted `is_error` follows the native success convention. That status describes the tool result; it does not establish that the overall task was correct. The neutral format has an explicit `unknown` result status when an adapter cannot establish an outcome.

One file is treated as one run. This release does not combine separate parent and subagent transcripts. A transcript may be incomplete, may contain events from a changing client format, and may record timestamps at a coarser level than individual tool execution.

## Projected data

The public data consists of fixed schema labels, enumerated tool categories and outcomes, counts, and durations. Tool categories are `shell`, `read`, `write`, `search`, `web`, `agent`, and `other`. Unrecognized tool names use `other`; they are not copied into the output as custom labels.

Original IDs are only for pairing while parsing. Raw tool names, commands, file paths, prompts, responses, source code, and absolute event timestamps must not survive into JSON or HTML artifacts. The same restriction applies to hidden HTML data and report scripts, not merely visible text.

Duration requires a valid start and end with end at or after start. An unknown duration must remain unknown. Total recorded call duration sums known call intervals; it is not wall-clock runtime, because concurrent intervals can overlap and gaps are not measured.

The format intentionally has no token-usage or monetary-cost fields in v0.1. Comparisons describe observations in the supplied traces, not task correctness or improvement attributable to a changed prompt or skill.

## Incomplete and repeated records

Calls are paired in file order. A start with no matching later end remains `pending`. A result that appears before its start is recorded as an orphan result, not retroactively paired. Repeated starts keep the first call; repeated results after a paired end keep the first result. Diagnostics count duplicate starts, duplicate ends, orphan ends, invalid timing, and ignored records so these cases remain visible.

Unrelated native records are ignored rather than rendered. Recognized message records can contain no tool calls; such a file can legitimately produce an empty activity receipt. Invalid JSON, invalid supported tool records, and mixed formats fail instead of producing a report. Inspect the diagnostics before treating two traces as comparable.

## Input limits

The default limits are **50 MiB per input file**, **1 MiB per JSONL line**, **200,000 nonblank JSON records**, and **100,000 tool calls**. Exceeding these limits produces an input error. Keep input files separate from the generated output directory; the CLI refuses output paths that would overwrite a selected input.

If you need to adapt another log format, start by converting a small synthetic example into neutral events. Verify pairings, explicit error status, unknown outcomes, and timestamp units before comparing real work.
