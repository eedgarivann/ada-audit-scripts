# ada-audit-scripts

Read-only command-line helpers for **WCAG 2.2 AA** accessibility audits, built on [Playwright](https://playwright.dev), [axe-core](https://github.com/dequelabs/axe-core) and the [Guidepup Virtual Screen Reader](https://github.com/guidepup/virtual-screen-reader). They are the script layer of the *ADA Compliance Master* audit skill, published so anyone can run and improve them.

> **Not a compliance certification.** Every output is a *candidate* for a human to confirm in the DOM and on screen. Automated tools find only part of the barriers on a site; a clean run does not mean a site "conforms" or is "ADA compliant", and it does not prevent complaints or lawsuits. Nothing here is legal advice.

## What it does
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
| `lib.mjs` | shared helpers, including `safePage`. |

## Read-only safety (`safePage`)
Every tool opens pages through `safePage` in `lib.mjs`. It blocks service workers and **aborts every request whose method is not GET, HEAD or OPTIONS** (form posts, `fetch` POST/PUT/DELETE, popups included) and logs them as "blocked writes". `--click` preparation refuses submit buttons. `forms.mjs --try-empty-submit` submits forms **empty**; a POST is blocked, so server-side validation is reported as *NOT TESTED*. `context-change.mjs` and `forms.mjs` also abort page navigations they trigger and log them instead of following them.
Do not remove `safePage`. GET links can still have side effects (logout, unsubscribe, add-to-cart): do not pass them to `--click`. Logins, real submissions and payments are out of scope for these tools; test those by hand on a staging site or test account the owner approves.

## Install
Node 20 or newer.
```
npm ci
npx playwright install chromium     # add --with-deps on a fresh Linux machine
```
Versions are pinned: playwright 1.65.1, axe-core 4.14.0, @axe-core/playwright 4.14.0, @guidepup/virtual-screen-reader 0.33.0. Record them in your report (each output header includes them).

## Usage
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
`npm test` (same as `npm run smoke`) is offline: it serves `test/fixtures/` (fictional pages with planted barriers and fixed twins) GET-only on 127.0.0.1, runs every tool, and checks that planted defects are found and the clean controls stay clean. CI runs only this. `npm run smoke:live` runs a few tools on `examples/urls.txt` (needs network).

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

## Accuracy notes (15 Nov 2026; estimates, not guarantees)
**W3C BAD demo.** Script-only recall against W3C's published failure lists for the four "before" pages (home, news, tickets, survey; WCAG 2.0 A/AA, 4.1.1 excluded; 73 page/criterion pairs): **67/73 (92%)** with 4.1.0, up from 59/73 (81%) in 4.0.0 and 31/73 (42%) in 3.x. New in 4.1.0: 1.3.2 and 2.4.1 found on all four pages (`bypass-order`, run with `--scope "#page"` to skip the demo's wrapper). Still missed: some 1.4.1, 1.4.3, 2.4.3, 2.4.6 cases. The four "after" pages raise no WCAG 2.0 A/AA candidates (only advisories such as "no `<main>`").

**Local fixtures (`test/fixtures`).** All 9 planted reading-order/bypass defects are flagged and the 3 clean controls stay clean. `journeys.mjs` finds all 7 planted journey traps (hover-only mega menu, cookie banner that keyboard users can't get past, focus behind an overlay, carousel that steals focus, unlabeled cart icon, 2.5.8 target spacing, timed redirect); the fixed twins reach the goal. The other tools miss the hover-only menu and the focus-stealing carousel outright, and show only symptoms (focus covered, generic clickable) for the cookie banner and overlay. They don't show that the goal is unreachable. On the separate form/checkout test site (15 seeded barriers), the scripts flagged 13/15; the 2 misses were server-side error handling, which needs a manual test on staging.

**10 public sites** (2 Shopify, 1 WordPress, 2 Squarespace, 2 Wix, 1 Webflow, a city government site and a nonprofit; homepage + up to 1 key page each, read-only, not named here). We hand-checked a stratified sample of 106 candidates. Estimated precision (true / (true + false); advisories and unclear items left out): inventory 6/7, tab-walk 9/10, axe 4/6 (the 2 false ones were one button measured in a transient state at two widths), forms 9/10, reflow 12/12, sr-transcript 7/7, sample-compare 1/1. In 4.1.0-rc, `bypass-order` was 0/15 and `context-change` focus-removed/change-on-input was 0/9: nav dropdowns clipped by `overflow`, image/caption pairs, cookie banners taking the first Tab stops, slide-in skip links, focus refused by hidden elements, and analytics beacons on typing. These were fixed before release; on the same pages the fixed versions raise none of those 24 false candidates. The W3C and fixture results are unchanged. Because the tuning was done on this sample, expect more false positives elsewhere. Misses seen by hand include a keyboard-focusable spam honeypot field (found only by `journeys`) and colour or meaning problems that need human judgement.

Caveats: tuning was done with the W3C answers visible, and the fixtures were written by the same authors. Recall is per page/criterion, not per instance. None of this means the scripts find a fixed share of issues on any site; a clean run is not conformance.

## License
MIT © ADA Compliance Master contributors. See `LICENSE`.
