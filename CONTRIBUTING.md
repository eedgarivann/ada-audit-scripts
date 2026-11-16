# Contributing

Thank you. Small, well-evidenced fixes are welcome: a planted bad/fixed fixture pair and a test are the best way to show that a detector or a remediation hint is right.

## Local setup
Node ≥20.11 (CI: 20, 22, 24).
```sh
npm ci
npx playwright install chromium       # --with-deps on a clean Linux machine
npm run check                        # lint + format check + unit tests
npm test                             # unit + E2E, all offline
```
The end-to-end tests start a GET-only server on 127.0.0.1:4176 and use fictional pages in `test/fixtures/`. Set `PORT=…` if that port is busy; `CONCURRENCY=…` to tune the pool; `SERIAL=1` to run jobs serially. `test/run-fixtures.sh` remains the original serial runner (`npm run test:serial`).

## Rules for changes
- **Never remove the read-only guard** (`safePage` in `src/core/lib.mjs`). Live sites are read-only, no login, pay or submit. Test writes on fixtures or owner-approved staging, not a live checkout.
- Keep the v4 root script commands and raw output formats working; the CLI adapters depend on them.
- New detector: add a rule to `src/findings/rules.mjs` (see [architecture](docs/architecture.md#adding-a-rule)), a remedy if needed, and a bad/fixed fixture pair with assertions. Distinguish A/AA failures, AAA, best practices and advisories. Do not promote a heuristic to `automated-certain` without a deterministic check.
- New schema field: additive and optional for v1; a breaking schema change needs a new major version. Update `types/index.d.ts`, schema docs and tests together.
- **No private site output**, customer URLs, personal data, credentials or tokens in code, fixtures, examples or reports. Only fictional fixtures and public W3C demos belong here. Strip file paths from sample output (`npm run sample-report`).
- Keep language honest: candidates, scope/method/date, no certification or legal advice. Guidepup is a simulated screen reader, not real AT; personas are simulations, not user testing. No overlays.
- Use ESM (`.mjs`), Prettier (`npm run format`) and ESLint (`npm run lint`). Prefer small pure functions in the findings/report layers. No runtime dependencies for reports.

## Before a pull request
1. `npm run check && npm test`.
2. `npm run sample-report` if findings/report code changed; review it for bad advice, missing evidence and private data.
3. Add a CHANGELOG entry; describe the user impact, the verification and any remaining limits.
4. For a detection change, include false-positive as well as true-positive tests.

Security reports: see [SECURITY.md](SECURITY.md). By contributing you agree your contribution is MIT licensed.
