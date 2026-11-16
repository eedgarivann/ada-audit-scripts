# ada-audit-scripts

[![CI](https://github.com/eedgarivann/ada-audit-scripts/actions/workflows/ci.yml/badge.svg)](https://github.com/eedgarivann/ada-audit-scripts/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Read-only accessibility audit toolkit for **WCAG 2.2 AA**. One command runs 13 checks (axe-core, real keyboard walks, forms, reflow, motion, a simulated screen reader, reading order and bypass, simulated persona journeys…) in parallel on a shared browser, merges what they find into one deduplicated, prioritized list, and writes a report that tells you **what is wrong, who it hurts, where it is, and exactly how to fix and re-test it**, with code and platform-specific steps.

It is the script layer of the *ADA Compliance Master* audit skill, published so anyone can run and improve it.

> **Not a compliance certification.** Every result is a *candidate* for a human to confirm. Automated checks find only part of the barriers on a site; a clean run does not mean a site "conforms" or is "ADA compliant", and it does not prevent complaints or lawsuits. Nothing here is legal advice.

## Quick start
Node 20.11 or newer.
```sh
git clone https://github.com/eedgarivann/ada-audit-scripts && cd ada-audit-scripts
npm ci
npx playwright install chromium            # add --with-deps on a fresh Linux machine

# Audit 3+ pages of one site (home, a content page, every step of a key journey):
npx ada-audit https://example.org/ https://example.org/about https://example.org/contact \
  --journey "Contact=https://example.org/contact" --journeys --goal contact \
  --platform wordpress --format json,md,html,sarif,csv
```
Open `audit-output/report.html` (or `report.md`). See a full [sample report](docs/sample-report/report.md) ([HTML](docs/sample-report/report.html), [JSON](docs/sample-report/findings.json)) made from the fictional checkout fixture.

## What you get
| File | For |
|---|---|
| `report.html` / `report.md` | people: executive summary, **fix plan** (quick wins → fix now → fix next → monitor), a findings table, then one card per finding: what is wrong, who it hurts and how badly, WCAG criteria, how it was found and how sure we are, every location with evidence and screenshots, **numbered fix steps, before/after code, your platform's steps, how to verify the fix**, references; simulated journey results; non-WCAG items kept separate; a manual-testing checklist; scope, methods and the evaluation statement to use |
| `findings.json` | machines: [schema v1](docs/findings-schema.md) (`npx ada-audit validate`) |
| `findings.sarif` | GitHub code scanning and IDEs (SARIF 2.1.0) |
| `findings.csv` | trackers and spreadsheets: one row per location, with a status column |
| `run.json`, `logs/` | timing per job, versions, tool logs |
| `axe/`, `tab-walk/`, … | the raw tool output (screenshots, transcripts) the findings point to |

How to read and act on the report, step by step: **[docs/report-guide.md](docs/report-guide.md)**.

## How findings are prioritized
Each candidate from each tool is mapped by a rule catalog (`npx ada-audit rules`) to a barrier type, WCAG success criteria, a **kind** (A/AA failure, AAA, best practice, advisory — only failures count against AA), **severity** (blocker → minor: impact on users) and **confidence** (`automated-certain` deterministic rule; `needs-review` heuristic, confirm in DOM and on screen; `inferred` cue). Candidates for the same barrier from different tools and pages are merged; something found by two tools is marked *corroborated*; something on many pages is a template issue you fix once. Findings are then ordered by a score (severity × confidence × reach × critical-journey × corroboration × priority rung ÷ effort) and put in a plan: **Fix now** (blocks a critical journey), **Fix next**, **Monitor**. Priority ladder: 1 forms/checkout/booking/login → 2 keyboard and focus → 3 contrast and alt text → 4 structure, names, language → 5 the rest. Details: [docs/findings-schema.md](docs/findings-schema.md#scoring-and-plan).

## CLI
```
ada-audit [run] <url...> [options]      run the audit and write reports
ada-audit report <dir>                  rebuild reports from existing raw output (also v4 output folders)
ada-audit validate <findings.json>      check a findings file against schema v1
ada-audit tools | rules [--json]        list tools / the rule catalog
```
Key options: `--urls file|a,b`, `-c config.json`, `-o dir`, `--journey "Name=url,url"` (repeat), `--journeys --goal buy|checkout|contact|donate|book --target "text"`, `--widths 390,1440`, `--tools` / `--skip`, `--platform wordpress|shopify|webflow|framer|squarespace|wix|react`, `--format json,md,html,sarif,csv`, `--concurrency n`, `--timeout ms`, `--job-timeout ms`, `--retries n`, `--fail-on serious` (CI gate). All options, the config file and exit codes: [docs/configuration.md](docs/configuration.md).

Use it in CI to stop regressions on a staging build:
```sh
npx ada-audit -c ada-audit.config.json --format json,sarif --fail-on serious   # exit 1 if a serious+ candidate failure is found
```

## The tools
`inventory`, `axe`, `tab-walk`, `forms`, `reflow`, `motion`, `sr-transcript`, `context-change`, `bypass-order`, `sample-compare` run by default; `journeys` (`--journeys`), `focus-state` (`--focus-selector`) and `menu-modal` (`--trigger`) on request. What each checks and how to run it on its own (the v4 commands such as `node axe-scan.mjs` still work unchanged): [docs/tools.md](docs/tools.md).

## Read-only safety (`safePage`)
Every tool opens pages through `safePage` in `src/core/lib.mjs`, also when it shares the run's browser. It blocks service workers and **aborts every request whose method is not GET, HEAD or OPTIONS** (form posts, `fetch` POST/PUT/DELETE, popups included) and logs them as "blocked writes". `--click` preparation refuses submit buttons. `forms.mjs --try-empty-submit` submits forms **empty**; a POST is blocked, so server-side validation is reported as *NOT TESTED*. `context-change.mjs` and `forms.mjs` also abort page navigations they trigger and log them instead of following them.
Do not remove `safePage`. GET links can still have side effects (logout, unsubscribe, add-to-cart): do not pass them to `--click`. Logins, real submissions and payments are out of scope for these tools; test those by hand on a staging site or test account the owner approves.

## Performance
One browser per run (Playwright browser server; each tool job connects to it and still gets fresh, isolated, read-only contexts), a bounded job pool (default: half the CPU cores, max 6), per-URL sharding, longest jobs first, navigation retries with backoff, per-job timeouts and one retry for crashed jobs. A fixed Tab-walk wrap bug also stopped runs from walking 60 stops on pages that had already wrapped.

Measured on the offline fixture suite (same 32 checks, same machine, 8 vCPU, 15 Nov 2026): **451 s** serial with v4.1.0 → **116 s** with v4.2.0 at concurrency 4 (**3.9× faster**). Total tool work was about the same (≈450 s), so the gain is from safe parallelism; expect less on a single slow site, where network time dominates.

## Development
```sh
npm run check          # eslint + prettier + unit tests (fast, no browser)
npm test               # unit + end-to-end: serves test/fixtures on 127.0.0.1, runs every tool and the CLI
npm run sample-report  # regenerate docs/sample-report from test/data (no network)
```
`test/fixtures/` holds fictional pages with planted barriers and fixed twins; the end-to-end suite checks that planted defects are found and the clean twins stay clean. Architecture, pipeline and how to add a rule: [docs/architecture.md](docs/architecture.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md).

## Limits
- Outputs are candidates. Confirm each in the DOM and on a screenshot; heuristics (fake headings, images of text, colour-only links, CSS backgrounds, timeouts, reading order) produce false positives and misses.
- `sr-transcript` and `journeys` are **simulations**: the Guidepup Virtual Screen Reader is not JAWS, NVDA, VoiceOver or TalkBack, and scripted personas are not disabled people. Report them as "Simulated SR" and "simulated persona journeys", never as screen-reader or user testing.
- No real assistive technology, no human judgement of alt quality, meaningful sequence, captions or plain language; no native apps, PDFs or canvas content.
- Server-side validation, logins, checkouts and payments are not exercised (read-only by design).
- Pages behind bot protection may render differently in headless Chromium. Tools print `WARNING: … bot-challenge or block page`; discard that output.
- Multi-page checks are only as good as the sample: pick ≥3 pages per template and every step of a process (WCAG-EM).
- Platform fix hints describe common settings and patterns; themes, apps and plans differ, so check them against your own setup.

## Accuracy notes (15 Nov 2026; estimates, not guarantees)
**W3C BAD demo.** Script-only recall against W3C's published failure lists for the four "before" pages (home, news, tickets, survey; WCAG 2.0 A/AA, 4.1.1 excluded; 73 page/criterion pairs): **67/73 (92%)** with 4.1.0, up from 59/73 (81%) in 4.0.0 and 31/73 (42%) in 3.x. New in 4.1.0: 1.3.2 and 2.4.1 found on all four pages (`bypass-order`, run with `--scope "#page"` to skip the demo's wrapper). Still missed: some 1.4.1, 1.4.3, 2.4.3, 2.4.6 cases. The four "after" pages raise no WCAG 2.0 A/AA candidates (only advisories such as "no `<main>`").

**Local fixtures (`test/fixtures`).** All 9 planted reading-order/bypass defects are flagged and the 3 clean controls stay clean. `journeys.mjs` finds all 7 planted journey traps (hover-only mega menu, cookie banner that keyboard users can't get past, focus behind an overlay, carousel that steals focus, unlabeled cart icon, 2.5.8 target spacing, timed redirect); the fixed twins reach the goal. The other tools miss the hover-only menu and the focus-stealing carousel outright, and show only symptoms (focus covered, generic clickable) for the cookie banner and overlay. They don't show that the goal is unreachable. On the separate form/checkout test site (15 seeded barriers), the scripts flagged 13/15; the 2 misses were server-side error handling, which needs a manual test on staging.

**10 public sites** (2 Shopify, 1 WordPress, 2 Squarespace, 2 Wix, 1 Webflow, a city government site and a nonprofit; homepage + up to 1 key page each, read-only, not named here). We hand-checked a stratified sample of 106 candidates. Estimated precision (true / (true + false); advisories and unclear items left out): inventory 6/7, tab-walk 9/10, axe 4/6 (the 2 false ones were one button measured in a transient state at two widths), forms 9/10, reflow 12/12, sr-transcript 7/7, sample-compare 1/1. In 4.1.0-rc, `bypass-order` was 0/15 and `context-change` focus-removed/change-on-input was 0/9: nav dropdowns clipped by `overflow`, image/caption pairs, cookie banners taking the first Tab stops, slide-in skip links, focus refused by hidden elements, and analytics beacons on typing. These were fixed before release; on the same pages the fixed versions raise none of those 24 false candidates. The W3C and fixture results are unchanged. Because the tuning was done on this sample, expect more false positives elsewhere. Misses seen by hand include a keyboard-focusable spam honeypot field (found only by `journeys`) and colour or meaning problems that need human judgement.

Caveats: tuning was done with the W3C answers visible, and the fixtures were written by the same authors. Recall is per page/criterion, not per instance. None of this means the scripts find a fixed share of issues on any site; a clean run is not conformance.

## License
MIT. See [LICENSE](LICENSE).
