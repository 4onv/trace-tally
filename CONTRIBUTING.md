# Contributing

TraceTally keeps a narrow promise: useful comparisons without transcript content in the generated artifacts. Please preserve that boundary when adding formats or presentation features.

## Work locally

Use Node.js 22 or newer. There are no dependencies to install.

```sh
node --test
node bin/trace-tally.mjs demo
```

Open the generated demo report and check that the comparison, labels, and missing-data explanations remain readable. For report changes, check a narrow browser window as well as a desktop layout.

## Make a focused change

- Describe the concrete input or workflow your change improves.
- Add synthetic fixtures for any new format. Never commit personal agent logs or credentials.
- Preserve explicit unknown outcomes and unavailable durations.
- Keep exports limited to the documented categories and numbers; arbitrary tool labels are not safe public metadata by default.
- Add meaningful tests for parser changes, particularly pair matching, errors, incomplete input, and fields that must be discarded.
- Update the format documentation when accepted records or command behavior changes.

Adapters should translate evidence that exists in the input. Do not infer that a task passed from an agent's prose, turn missing results into success, or label summed call durations as elapsed runtime.

Privacy tests should seed distinctive strings into discarded fields and check both JSON and HTML, including embedded data. For a rendering change, check that malicious strings cannot become executable markup.

## Useful next contributions

More real-world format coverage can help, provided each supported shape has synthetic tests and documented limitations. Other useful work includes clearer incomplete-trace diagnostics and comparisons that help users investigate differences without claiming causal or statistical significance.

Keep the runtime dependency-free unless a proposed dependency solves a concrete problem that cannot reasonably be handled by the existing implementation.

See [SECURITY.md](SECURITY.md) before reporting a problem involving private content.
