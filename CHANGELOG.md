# Changelog

## 0.2.1 — 2026-11-07

- Added an installable GitHub release archive, standalone synthetic report and SHA-256 checksums.
- Added offline archive installation checks for the installed CLI, recorder, parser and report APIs on Linux and Windows with Node 22/24.
- Read the CLI version from package metadata so installed distributions report their actual version.

## 0.2.0 — 2026-11-01

- Added a bounded in-memory recorder for JavaScript tool integrations, with fixed categories and no operation-content logging.
- Preserve operation return values and original errors, including concurrent calls and clock failures.
- Added a synthetic instrumentation example and tests for the recorder's export boundary and lifecycle.

## 0.1.0 — 2026-11-01

- Initial Claude/neutral JSONL adapters, metadata-only comparisons, standalone reports, and synthetic examples.
