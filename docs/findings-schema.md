# Findings schema v1

`findings.json` is the single machine-readable output of a run. Every tool's raw output is converted into it by `src/findings/adapters.mjs` and `src/findings/model.mjs`. JSON Schema (draft 2020-12): [`schema/findings.schema.json`](../schema/findings.schema.json). Validate with `npx ada-audit validate findings.json`.

**Versioning.** `schemaVersion` follows semver. Minor versions only add optional fields; a field is never removed or retyped without a major version (`2.0.0`). Consumers should ignore unknown fields.

## Top level
| Field | Meaning |
|---|---|
| `schemaVersion` | `1.x.y` |
| `generator` | tool name, version, URL |
| `run` | `startedAt`, `finishedAt`, `pages[]`, `tools[]`, `widths[]`, `versions{tool,node,playwright,axe,vsr}`, `readOnly`, `platform` |
| `criticalJourneys[]` / `journeysAssumed` | the named journeys (`--journey` / config). If none were named, every page counts as a journey page and `journeysAssumed` is `true`. |
| `summary` | counts by kind, severity, confidence, plan; `quickWins`; `failuresConfirmedByRules` |
| `journeys[]` | simulated persona outcomes per start page (`reached`, `ok`, `at risk`, `gave up`, `stuck`) |
| `findings[]` | see below, already in fix order |
| `suppressed[]` | candidates dropped by a cross-check, with the reason (kept for transparency) |
| `conformance` | `{ target, statement, claim: false }`: the evaluation-statement wording to use. `claim` is always `false`. |
| `manualChecklist[]` | `{ sc, check, priority? }` checks automation cannot make, priority items first |

## Finding
| Field | Meaning |
|---|---|
| `id` | `F-001`… in fix order; stable for the same input |
| `fingerprint` | 16-hex hash of the dedupe group; stable across runs (track it in issue trackers). Each location has its own `fingerprint` too. |
| `group` | dedupe key: findings from different tools/pages that describe the same barrier share it |
| `title` | plain-language name of the barrier |
| `kind` | `failure` (WCAG 2.2 A/AA candidate), `best-practice`, `aaa`, `advisory`, `not-tested`, `other-risk`. Only `failure` counts against WCAG AA. |
| `wcag[]` | `{ sc, name, level, since, url }` (Understanding document) |
| `severity` | impact on users: `blocker` (cannot complete a journey), `critical`, `serious`, `moderate`, `minor` |
| `confidence` | `automated-certain` (deterministic rule: axe violation or DOM fact), `needs-review` (heuristic: confirm in DOM + screenshot), `inferred` (static cue or root-cause guess) |
| `corroborated` | found by 2+ independent tools |
| `priority` | `{ plan, rung, score, quickWin }` (below) |
| `effort` | `low` (< 1 h; content or a setting), `medium` (hours to a day; template/CSS/JS), `high` (days; rebuild or vendor) |
| `onCriticalJourney`, `scope`, `pages`, `occurrences` | where it matters and how widespread it is (`multi-page` usually = shared template: fix once) |
| `impact` | `who` it hurts (plain sentence), simulated `personas` and `simulatedOutcomes` |
| `howFound[]` | evidence type per tool: *Automated (axe-core x)*, *Keyboard test (scripted)*, *Simulated SR*, *Simulated persona journey*… Never "tested with a screen reader". |
| `rules[]`, `tools[]` | contributing rule ids (`ada-audit rules`) and tools |
| `locations[]` | `{ url, target (selector or element), widths[], journey, screenshots[], evidence[{tool, rule, detail, file, line, html}], fingerprint }` |
| `remediation` | `{ concept, summary, steps[], before, after, platforms{wordpress,shopify,webflow,framer,squarespace,wix,react}, verify, references[] }` |

## Scoring and plan
- **Rung** (priority ladder): 1 forms/checkout/contact/booking/login, 2 keyboard and focus, 3 contrast and alt text, 4 structure, names, language, 5 the rest. A barrier that made a simulated persona get stuck or give up is moved to rung 1.
- **Score** (failures only) = severity weight (100/60/30/10/3) × confidence (1/0.7/0.4) × reach (1 + log2 pages) × 1.5 if on a critical journey × 1.2 if corroborated × (7 − rung)/6, ÷ effort cost (1/3/8). Higher first.
- **Plan**: *Fix now* = blocker/critical in rungs 1–3 on a critical journey (not merely inferred). *Fix next* = other blocker/critical, serious on a journey, rung-4 issues across pages, and low-effort journey failures. *Monitor* = the rest, plus every non-failure. *Quick win* = low-effort failure of moderate severity or worse.
- **Dedupe**: rules map to a `group`; candidates in the same group merge across tools and pages; locations merge on URL + element (`#id` and `input#id` are the same element). Severity is the maximum, confidence the strongest.
- **Cross-checks**: a "possible keyboard trap" from a Tab pass is dropped when the full Tab walk of the same page completed (`suppressed[]`). Tool confidence `low` downgrades to `inferred` and lowers severity one step.

## Exports
- `report.md` / `report.html` — human report (accessible HTML: skip link, landmarks, captioned tables, no JS).
- `findings.sarif` — SARIF 2.1.0, one result per location, `partialFingerprints["adaAudit/v1"]` for GitHub code scanning.
- `findings.csv` — one row per location with a `status` column (Open) for a remediation log.
