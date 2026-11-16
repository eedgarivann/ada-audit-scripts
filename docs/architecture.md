# Architecture

```
bin/ada-audit.mjs            CLI entry (npx ada-audit)
src/cli/ada-audit.mjs        argument/config parsing, job planning, exit codes
src/core/runner.mjs          shared browser server, concurrency pool, timeouts, retries, shard merge
src/core/lib.mjs             safePage (read-only guard), open (retries), helpers shared by tools
src/tools/*.mjs              the 13 audit tools (plain scripts; unchanged CLI and output formats)
src/tools/registry.mjs       how the CLI runs each tool (default set, sharding, flags)
src/findings/rules.mjs       rule catalog: tool flag code -> concept, WCAG SC, kind, confidence, severity, dedupe group
src/findings/remediation.mjs fix library per concept: who it hurts, steps, before/after code, platform hints, verify
src/findings/wcag.mjs        WCAG 2.2 SC table (names, levels, Understanding links)
src/findings/adapters.mjs    raw tool output -> raw candidates (pure functions over files)
src/findings/model.mjs       normalise, cross-check, dedupe, score, plan, stable IDs
src/findings/document.mjs    findings document assembly (schema v1)
src/findings/validate.mjs    dependency-free schema validator
src/report/*.mjs             Markdown, accessible HTML, SARIF 2.1.0, CSV; guidance.mjs = shared wording
schema/findings.schema.json  JSON Schema 2020-12
types/index.d.ts             TypeScript declarations for the public API (src/index.mjs)
test/unit, test/e2e          node:test suites; test/fixtures = fictional pages with planted barriers and fixed twins
root *.mjs                   v4 entry points (thin wrappers) — existing commands keep working
```

## Run pipeline
1. **Plan** — tools × URLs × widths become jobs. Per-URL tools are sharded (one job per page, own output folder).
2. **Run** — one Chromium server per run (`chromium.launchServer`); each job is a child process that connects through `ADA_BROWSER_WS` (`safePage`), so the browser starts once, every job still gets fresh, isolated contexts and the read-only route guard. A pool runs `--concurrency` jobs at a time, longest first. Jobs have a timeout and are retried once if they crash; navigation errors retry with backoff inside the tool.
3. **Merge** — shard folders are merged into the output folder (summaries concatenated).
4. **Normalise** — adapters read the raw files (so `ada-audit report` also works on folders made by the v4 scripts) and the model builds `findings.json`, then the reports.

Why processes, not one in-process loop: the tools are self-contained scripts with their own flags and output files, and process isolation means a hung or crashing page cannot take the whole run down. Sharing the browser removes the main per-tool cost (launch) while keeping that isolation.

## Read-only guarantee
`safePage` routes every request in the context and aborts anything other than GET/HEAD/OPTIONS, blocks service workers and logs blocked writes. Connecting to the shared browser does not change this: the route is installed on each tool's own context. Do not remove it.

## Adding a rule
1. Emit the flag code from the tool (text line or JSON).
2. Add it to `src/findings/rules.mjs` (concept, SC, kind, confidence, severity; `group` if it should merge with another detector).
3. If it is a new kind of barrier, add a remedy to `src/findings/remediation.mjs`.
4. Add a fixture pair (bad + fixed) and assertions; `npm test`.
