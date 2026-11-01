# Security and privacy

TraceTally reads files explicitly selected by the user. It does not execute commands from a trace, run model-generated code, invoke an LLM, or automatically scan agent directories. Its reporting workflow has no upload service or telemetry.

## Export boundary

JSON and HTML outputs are built from an allowlisted projection: fixed schema labels, tool categories, outcomes, counts, and durations. Unknown tool names become `other`. Raw prompts, responses, thinking, source, commands, paths, call IDs, original tool names, and absolute timestamps must not be embedded, including in hidden page data or scripts.

This is data minimization, not a promise of anonymity. Counts, timing, tool categories, and failure patterns can disclose activity. Review an artifact before sharing it, and keep the raw input trace under appropriate access controls. TraceTally does not remove the original input or change its permissions.

The artifact is not proof of an authentic agent run, trustworthy source data, completed work, or correct code. A supplied log can be incomplete or fabricated. The tool does not attest or cryptographically verify that an execution happened.

## Handling untrusted inputs

Inputs are bounded by file size, line size, and event-count limits. Invalid or excessive input should fail with a concise error. Trace strings are data, never instructions. A report must not inject input strings into executable HTML, scripts, CSS, URLs, or filenames.

One input file represents one run. Separate subagent logs are not merged. Missing timing or uncertain outcomes must not become invented zero durations or successful calls.

Privacy regression tests should place distinctive sensitive-looking strings in every discarded field, including nested arguments and results, then assert that none occur in any exported artifact. Also test malicious HTML strings, unrecognized tool names, malformed records, and bounded input handling. These tests defend the intended projection; they cannot prove that metadata reveals nothing.

## Reporting a problem

Do not include real credentials, customer data, private transcripts, or proprietary code in a public issue. Provide a minimal synthetic reproducer when reporting ordinary parser or rendering bugs. For a sensitive disclosure, use GitHub's private vulnerability reporting channel if it is enabled for this repository; otherwise request a private reporting channel without posting the sensitive details.
