# Synthetic examples

These are deliberately invented traces. They are not measurements of a real model, a productivity claim, or evidence of improved task quality.

| File | Format | Tool calls | Errors | Sum of known tool durations |
| --- | --- | ---: | ---: | ---: |
| `before.jsonl` | Neutral events | 8 | 3 | 9,140 ms |
| `after.jsonl` | Neutral events | 5 | 1 | 3,760 ms |
| `claude-small.jsonl` | Claude transcript shape | 2 | 1 | 1,750 ms |

The `SYNTHETIC_PRIVATE_*` strings represent content that must not appear in exported receipts. They are fake markers, not credentials. Original tool IDs and absolute timestamps must also disappear. Unknown tool names become the fixed `other` category.

Run `node bin/trace-tally.mjs demo` from the repository root for a visibly labeled demonstration. The neutral files can also exercise `compare`; that command cannot infer whether a user's input represents a real or synthetic run. The `demo` command applies the demonstration label explicitly.

The two tools in `claude-small.jsonl` begin at the same timestamp. Their durations add to 1,750 ms even though their observed shared interval is 1,500 ms. Summed durations are not wall-clock run time.
