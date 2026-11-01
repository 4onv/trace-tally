<p align="center"><img src="assets/banner.svg" alt="TraceTally — compare activity, keep context local" width="100%"></p>

# TraceTally

[![CI](https://github.com/4onv/trace-tally/actions/workflows/ci.yml/badge.svg)](https://github.com/4onv/trace-tally/actions/workflows/ci.yml)

**Compare agent runs without putting the conversation in the report.**

TraceTally turns two local agent traces into a small, shareable comparison of tool activity, errors, and recorded durations. It exports a deliberately limited set of categories and numbers. Prompts, responses, source code, commands, file paths, original tool names, call IDs, and absolute timestamps stay out of the generated artifacts.

It is a Node.js CLI with **zero dependencies, no model API, and no server**.

## Try the demo

With [Node.js 22 or newer](https://nodejs.org/) installed:

```sh
git clone https://github.com/4onv/trace-tally.git
cd trace-tally
node bin/trace-tally.mjs demo
```

Open `.trace-tally/demo/report.html` in a browser. The demo uses **synthetic traces**, not measured production improvements. It requires no account, dependency installation, or Docker.

A generated [sample report](examples/sample-report.html) is included; download it and open it locally.

This project is not published to npm. The commands here run the checked-out source directly.

## Compare your runs

Select the files you want to inspect; TraceTally does not automatically scan your home directory.

```sh
node bin/trace-tally.mjs compare before.jsonl after.jsonl
```

The default output directory is `.trace-tally/comparison`:

| Artifact | What it contains |
| --- | --- |
| `comparison.json` | Projected metrics for the baseline and candidate runs |
| `report.html` | A standalone visual comparison that can be opened locally |

The default `auto` format accepts supported Claude Code JSONL records and TraceTally's neutral event schema. Select a format explicitly when needed:

```sh
node bin/trace-tally.mjs compare before.jsonl after.jsonl --format claude --out .trace-tally/review
```

For a simple automation gate, use `--fail-on-more-errors`. It exits with code `1` when the candidate has more recorded error calls than the baseline:

```sh
node bin/trace-tally.mjs compare before.jsonl after.jsonl --fail-on-more-errors
```

That is an absolute error-count gate, not an error-rate comparison, a test of statistical significance, or evidence that either run completed its task correctly.

## Inspect a single trace

```sh
node bin/trace-tally.mjs inspect session.jsonl --format auto
```

This writes only `receipt.json` to `.trace-tally/receipt`. Use it when you need the projected data without a comparison report.

To rebuild the HTML from an existing comparison:

```sh
node bin/trace-tally.mjs report .trace-tally/comparison/comparison.json --out .trace-tally/rebuilt
```

## What the comparison means

- Tools are grouped into fixed categories: **shell, read, write, search, web, agent, and other**. Unknown tool names become `other`.
- Calls and results are paired internally. Their original IDs are not exported.
- A duration is available only when both timestamps are valid and the result is not earlier than the start. Missing timing is not zero time.
- Adding call durations does **not** produce wall-clock runtime. Calls may overlap, and the trace may omit activity.
- Fewer errors or tool calls may be useful evidence to investigate. They do not establish better code, a completed task, or a causal improvement.
- Version 0.1 does not report tokens, money, model quality, or hidden reasoning.

See [the input format and CLI reference](docs/format.md) for examples and limits.

## Privacy through smaller exports

TraceTally builds exports from allowed fields rather than embedding the transcript and trying to remove sensitive words afterward. It does not upload your input or output. Reports require no remote assets.

**Metadata is not guaranteed anonymous.** Tool categories, activity counts, durations, and error patterns can still reveal how work happened. Review every artifact before sharing, and retain the original trace under your own access controls. See [SECURITY.md](SECURITY.md).

One input file is treated as one run. TraceTally does not merge a multi-agent execution tree, certify log authenticity, or prove a task succeeded. Native transcript formats can change; supported shapes are documented in [docs/format.md](docs/format.md).

## Development

```sh
node --test
node bin/trace-tally.mjs demo
```

Useful contributions include carefully tested format adapters, clearer missing-data diagnostics, and representative synthetic fixtures. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

[Research and existing alternatives](docs/research-2026-10-31.md) explain why this project focuses on a small comparison artifact rather than full transcript playback.

MIT licensed.
