# Changelog

## 4.2.0 — 2026-11-15

### Added
- Unified `ada-audit` CLI: run, report, validate, tools, rules; JSON config, named critical user journeys, platform hints, severity CI gate and documented exit codes.
- Versioned findings schema v1 (JSON Schema 2020-12) and ESM API with TypeScript declarations. Adapters preserve the v4 raw output, normalize rule codes and axe JSON, deduplicate across tools/pages and assign deterministic fingerprints.
- Explicit severity, confidence, A/AA vs AAA/best-practice/advisory kinds, impact, evidence, WCAG references, fix priority, effort, numbered resolution, before/after code, platform hints and verification for every finding.
- Executive/fix-plan Markdown and accessible, script-free HTML reports, SARIF 2.1.0 and CSV.
- Shared Chromium browser server, bounded job pool, per-URL sharding, navigation retry/backoff, job timeouts/retry and per-job timing/logs.
- Unit and end-to-end suites (original 32 fixture checks preserved), fictional bad/fixed checkout fixtures, reproducible sample report, CI on Node 20/22/24, lint/format configuration, architecture/config/schema/report guides, contributor and security policies.

### Changed
- Sources moved to `src/core`, `src/tools`, `src/findings`, `src/report`, `src/cli`; all root script names remain compatibility wrappers with the same flags and raw output formats.
- Tab walk stops when it completes a circuit even after the page scrolls (viewport rect no longer makes it walk 60 repeated stops).
- Reports cross-check possible traps against completed Tab walks, avoid counting forms summaries twice and normalize `input#id` / `#id` to one location.
- WCAG A/AA failures, AAA and non-failures stay separate. Simulated SR/persona methods and not-tested/manual checks are explicitly labeled; no compliance claim.

### Performance
Offline fixture suite (same 32 assertions, same 8-vCPU machine): v4.1.0 serial 451 s → v4.2.0 concurrency 4, one browser 116 s (3.9× faster). The full E2E suite, including CLI/report checks, took 156 s. These are local measurements, not a guarantee on live sites.

## 4.1.0 — 2026-11-15

Previous release: reading-order/bypass and context-change candidate precision fixes, scripted persona journeys and read-only fixture coverage. See the [tag](https://github.com/eedgarivann/ada-audit-scripts/tree/v4.1.0) for the prior source and README.
