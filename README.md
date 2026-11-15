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
```
`npm run smoke` runs four tools on `examples/urls.txt`.

## Simulated screen reader disclaimer
`sr-transcript.mjs` output starts with: *"Simulated screen reader output (Guidepup Virtual Screen Reader). Not JAWS, NVDA or VoiceOver; confirm with a real screen reader."* It reads the accessibility tree the way a screen reader might; it is **not** a screen-reader test. Report it as "Simulated SR", never as "tested with a screen reader".

## Limits
- Outputs are candidates. Confirm each in the DOM and on a screenshot; heuristics (fake headings, images of text, colour-only links, CSS backgrounds, timeouts) produce false positives and misses.
- No real assistive technology, no human judgement of alt quality, reading order, captions or plain language; no native apps, PDFs or canvas content.
- Server-side validation, logins, checkouts and payments are not exercised (read-only by design).
- Pages behind bot protection or that need JavaScript from blocked origins may render differently in headless Chromium.
- Multi-page checks are only as good as the sample: pick ≥3 pages per template and every step of a process (WCAG-EM).

## Accuracy notes (W3C BAD demo, 15 Nov 2026)
Script-only recall against W3C's published failure lists for the four BAD "before" pages (home, news, tickets, survey; WCAG 2.0 A/AA, 4.1.1 excluded; 73 page/criterion pairs): **59/73 (81%)**, up from 31/73 (42%) with the 3.x scripts. On the four "after" pages the scripts raised no WCAG 2.0 A/AA candidates (the only extras were 2.5.8 target size from WCAG 2.2 and 1.3.5 on the survey, both outside the 2.0 key). Still missed by scripts: 1.3.2 reading order, 2.4.1 bypass, some 1.4.1/1.4.3/2.4.3/2.4.6 cases.

On a local test site with 15 seeded form/login/checkout barriers, the scripts flagged 13/15 with no confirmed false positives on the fixed pages; the 2 misses were server-side error handling, which needs a manual test on staging.

Caveats: the tuning was done with the W3C answers visible, and the test site was written by the same authors, so expect lower recall on real sites. Recall is per page/criterion, not per instance. These numbers do not mean the scripts find a fixed share of issues on any site.

## License
MIT © ADA Compliance Master contributors. See `LICENSE`.
