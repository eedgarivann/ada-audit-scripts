# The tools

Each tool is a plain ESM script in `src/tools/` with a back-compat entry point of the same name in the repo root (`node axe-scan.mjs …` still works). The unified CLI (`ada-audit`) runs them for you, in parallel, and turns their raw output into findings; you only need these commands for one-off checks or special states.

| Tool | Checks (main WCAG SCs) |
|---|---|
| `inventory.mjs` | title, `lang` (3.1.1), headings, landmarks, skip link, images and alt quality (1.1.1), CSS background images (1.1.1, F3), fake/generic headings and labels (1.3.1, 2.4.6), links told apart by colour only (1.4.1), images of text (1.4.5), overlay widgets, demo/placeholder pages, dead `#` links, third-party hosts; `--site` reads sitemaps + WordPress REST. Writes an `*_images.html` contact sheet for the alt-vs-pixels review. |
| `axe-scan.mjs` | axe-core at 390 and 1440 px (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`); JSON, screenshot and `summary.tsv`. |
| `tab-walk.mjs` | real Tab / Shift+Tab walk: missing focus ring (2.4.7), focus covered (2.4.11), off-screen, focus lost to `<body>` (F55), traps (2.1.2). |
| `focus-state.mjs` | settled hover/focus colours and contrast of chosen elements. |
| `menu-modal.mjs` | menus, dialogs, drawers: trigger focusable and opens by Enter/Space (2.1.1, 4.1.2), focus inside, Tab containment, Esc, focus return, `aria-expanded`. |
| `forms.mjs` | labels (3.3.2, 4.1.2), placeholder-only, required cue (incl. colour-only), `autocomplete` for personal data (1.3.5), paste blocking (3.3.8), split one-time-code boxes, CAPTCHA without alternative (1.1.1, 3.3.8), controls outside `<form>`; `--try-empty-submit` checks client-side errors: colour-only (1.4.1, 3.3.1), not announced (4.1.3), not linked to fields, focus not moved. |
| `reflow.mjs` | 320/640 px horizontal overflow (1.4.10) and text-spacing clipping (1.4.12). |
| `motion.mjs` | movement with `prefers-reduced-motion` on/off, autoplay video, infinite animations, pause controls (2.2.2, 2.3.3). |
| `sr-transcript.mjs` | **simulated** screen-reader transcript: linear read, heading/landmark lists, Tab pass; flags unnamed controls, vague/duplicate links, layout tables, heading skips. |
| `context-change.mjs` | focus that is removed or changes context (3.2.1, F55), select/typing that navigates (3.2.2), mouse-only click handlers (2.1.1), session timeouts with `--idle` (2.2.1). |
| `sample-compare.mjs` | needs ≥2 (ideally ≥3) pages of one site: duplicate titles (2.4.2), navigation order (3.2.3), unnamed or inconsistently named repeated components (3.2.4), help-link order (3.2.6), fields asked again across steps (3.3.7 cue). |
| `bypass-order.mjs` | **needs-human-confirmation** candidates for reading order (1.3.2: CSS `order`, `*-reverse`, absolute/float/grid placement that shows later DOM text above or left of earlier text; header-less layout tables read cell by cell), positive-`tabindex` focus jumps (2.4.3), and bypass (2.4.1): real Tab to the skip link, Enter, target exists, focus moves, next Tab lands inside; no main/headings with a repeated block. `--widths 390,1440`, `--scope "css"`. |
| `journeys.mjs` | **simulated** persona journeys toward a goal (`--goal buy\|checkout\|contact\|donate\|book\|<words>`, `--target "product"`): keyboard-only (skip link first, Tab, Escape/Shift+Tab, overlay escape), screen reader (headings, landmarks, links list, read-down; Guidepup), low vision (320 px + 200 % text), tremor (Monte Carlo taps, 2.5.8 spacing, hover-only menus), hurried (auto-advance, timeouts, focus moved by itself). Memory and frustration model (loops, traps, lost/covered/off-screen focus, gives up at `--budget`), cost vs an efficient path, seeded realism (`--seed`). Stops before the final submit/pay/login and reports "reached". Output: narrative, step log, screenshots, WCAG candidates with confidence. |

## Direct use (v4-compatible)
Common flags: `--urls file.txt` (one URL per line, `#` comment lines) or `--urls a,b`; `--out dir` (default `./audit-output`); `--channel chrome` (use installed Chrome); `--click "sel;sel"` (open a menu/tab first; submit controls are refused).
```
node inventory.mjs --urls examples/urls.txt            # or --site https://example.org
node axe-scan.mjs --urls examples/urls.txt --widths 390,1440
node tab-walk.mjs --urls examples/urls.txt --width 390 [--shift] [--max 60] [--settle 1000]
node focus-state.mjs --urls examples/urls.txt --selector "a.button;button"
node menu-modal.mjs --urls https://example.org --trigger ".menu-toggle" --container "#menu" [--modal]
node forms.mjs --urls https://example.org/contact --try-empty-submit
node reflow.mjs --urls examples/urls.txt
node motion.mjs --urls examples/urls.txt
node sr-transcript.mjs --urls examples/urls.txt [--desktop] [--max 1500] [--tabs 60]
node context-change.mjs --urls examples/urls.txt [--idle 70]
node sample-compare.mjs --urls https://example.org/,https://example.org/about,https://example.org/contact [--title-strip "regex"]
node bypass-order.mjs --urls examples/urls.txt [--widths 390,1440] [--scope "#page"]
node journeys.mjs --urls https://example.org/ --goal buy --target "lantern" [--personas keyboard,sr,zoom,tremor,hurried] [--seed 7] [--budget 60] [--max-pages 4]
```

Raw output from direct runs can be turned into a report at any time: `npx ada-audit report ./audit-output`.

## Environment variables (all tools)
| Variable | Default | Meaning |
|---|---|---|
| `ADA_BROWSER_WS` | unset | connect to a shared Playwright browser server instead of launching one (set by `ada-audit`) |
| `ADA_NAV_TIMEOUT` | `90000` | ms per navigation attempt (`networkidle`, then `load` on timeout) |
| `ADA_NAV_RETRIES` | `2` | retries for network errors with exponential backoff (1 s, 2 s, …) |
| `ADA_SETTLE` | `1500` | ms to wait after load before measuring |

## Simulated screen reader disclaimer
`sr-transcript.mjs` output starts with: *"Simulated screen reader output (Guidepup Virtual Screen Reader). Not JAWS, NVDA or VoiceOver; confirm with a real screen reader."* It reads the accessibility tree the way a screen reader might; it is **not** a screen-reader test. Report it as "Simulated SR", never as "tested with a screen reader".

## Simulated persona journeys disclaimer
`journeys.mjs` output starts with *"SIMULATED persona journeys"*. The personas are scripted models of how some disabled people browse, not people and not assistive technology; timings and errors are seeded estimates. A "reached" result is not proof a real user can finish, and a "gave up" result needs a human check. Never report it as user testing. It never submits, pays or logs in; a route guard blocks navigations it did not intend.

## Limits
- Outputs are candidates. Confirm each in the DOM and on a screenshot; heuristics (fake headings, images of text, colour-only links, CSS backgrounds, timeouts) produce false positives and misses.
- No real assistive technology, no human judgement of alt quality, meaningful sequence, captions or plain language (`bypass-order.mjs` flags reading-order *candidates* only); no native apps, PDFs or canvas content.
- Server-side validation, logins, checkouts and payments are not exercised (read-only by design).
- Pages behind bot protection or that need JavaScript from blocked origins may render differently in headless Chromium. Tools print `WARNING: … bot-challenge or block page` when a page looks like one; discard that output.
- Multi-page checks are only as good as the sample: pick ≥3 pages per template and every step of a process (WCAG-EM).

