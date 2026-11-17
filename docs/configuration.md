# Configuration

Everything can be set by flags; a JSON config file (`-c ada-audit.config.json`) is easier to keep in a repo. Flags override the file. Example: [`examples/ada-audit.config.json`](../examples/ada-audit.config.json).

| Key | Flag | Default | Notes |
|---|---|---|---|
| `urls` | positional, `--urls file\|a,b` | — | WCAG-EM sample: every common view, page type and journey step |
| `journeys` | `--journey "Name=url,url"` | none (all pages assumed critical) | name the critical user journeys; pages not on one get lower priority |
| `runJourneys`, `goal`, `target`, `personas` | `--journeys --goal --target --personas` | off | simulated persona journeys (start page = first URL of each named journey) |
| `widths` | `--widths` | `[390, 1440]` | mobile first |
| `tools` / `skip` | `--tools`, `--skip` | default set | `ada-audit tools` lists them |
| `focusSelector`, `trigger` | `--focus-selector`, `--trigger` | — | enable focus-state / menu-modal |
| `tryEmptySubmit` | `--try-empty-submit` | off | press submit on empty forms (writes are blocked) |
| `platform` | `--platform` | — | fix hints for that platform first |
| `formats` | `--format` | `json,md,html,pdf` | `pdf` = the client-ready PDF report; add `sarif,csv` for dev tools and trackers |
| `paper` | `--paper` | `a4` | PDF page size: `a4` or `letter` |
| `concurrency` | `--concurrency` | half the CPU cores (1–6) | parallel tool jobs on one shared browser |
| `timeouts.navigation`, `timeouts.job` | `--timeout`, `--job-timeout` | 90 000, 600 000 ms | |
| `retries` | `--retries` | 2 | navigation retries; crashed jobs retry once |
| `failOn` | `--fail-on` | — | CI gate: exit 1 on a failure at/above this severity |
| `channel` | `--channel chrome` | bundled Chromium | |
| `out` | `-o, --out` | `./audit-output` | |

## Exit codes
| Code | Meaning |
|---|---|
| 0 | run completed (and no failure at/above `--fail-on`) |
| 1 | a candidate WCAG failure at/above `--fail-on` was found (`validate`: file invalid) |
| 2 | usage or configuration error |
| 3 | runtime error: a tool job failed after retries, or the browser could not start |

## Reproducible output
Findings are sorted and numbered deterministically. Set `SOURCE_DATE_EPOCH` to pin `run.startedAt`/`finishedAt`; per-job timings go to `run.json`, not `findings.json`.
