# Benchmark: W3C BAD: Inaccessible Home Page Report (WCAG 2.0)

Answer key: https://www.w3.org/WAI/demos/bad/before/reports/home.html (18 scorable A/AA criteria; Level A/AA criteria W3C marks Fail on the before page. 4.1.1 Parsing is excluded (obsolete in WCAG 2.2). AAA failures (1.4.6, 1.4.8, 1.4.9, 2.1.3, 2.4.8, 2.4.9, 2.4.10, 3.2.5) are out of scope.)
Screen-reader-audible subset (13): 1.1.1, 1.3.1, 1.3.2, 2.1.1, 2.4.1, 2.4.2, 2.4.4, 2.4.6, 2.4.7, 3.1.1, 3.2.1, 3.3.2, 4.1.2. Criteria a screen-reader user can in principle notice by listening (judgement of the benchmark author, not W3C). Contrast, colour, images of text, on-input and cross-page consistency are not audible on one page.
Run: 2026-11-16T05:27:09.048Z → 2026-11-16T05:29:50.635Z; tools: inventory, axe, tab-walk, forms, reflow, motion, sr-transcript, context-change, bypass-order, sample-compare, real-sr; real screen readers: NVDA 2026.3 + chromium; VoiceOver macOS 15.8.2 + webkit

| Evidence method | SC recall (of 18) | Audible recall (of 13) | Hits | After-page failures flagged (false-positive candidates) |
|---|---|---|---|---|
| real-screen-reader (any) | 8/18 = 44% | 62% | 1.1.1, 1.3.1, 2.1.1, 2.4.4, 2.4.7, 3.2.1, 3.3.2, 4.1.2 | 0 |
| real NVDA | 8/18 = 44% | 62% | 1.1.1, 1.3.1, 2.1.1, 2.4.4, 2.4.7, 3.2.1, 3.3.2, 4.1.2 | 0 |
| real VoiceOver | 5/18 = 28% | 38% | 1.1.1, 1.3.1, 2.4.4, 3.3.2, 4.1.2 | 0 |
| simulated screen reader | 3/18 = 17% | 23% | 1.1.1, 2.4.4, 4.1.2 | 0 |
| automated rules (axe) | 7/18 = 39% | 46% | 1.1.1, 1.3.1, 1.4.3, 2.4.4, 3.1.1, 3.3.2, 4.1.2 | 1: F-007 Touch targets too small or too close (2.5.8) |
| scripted suite without real SR | 16/18 = 89% | 85% | 1.1.1, 1.3.1, 1.3.2, 1.4.1, 1.4.3, 1.4.5, 2.1.1, 2.4.4, 2.4.6, 2.4.7, 3.1.1, 3.2.1, 3.2.2, 3.2.4, 3.3.2, 4.1.2 | 3: F-007 Touch targets too small or too close (2.5.8); F-010 Reading/focus order does not match what is shown (1.3.2); F-014 Page scrolls sideways at 320 px (1.4.10) |
| everything (suite + real SR) | 16/18 = 89% | 85% | 1.1.1, 1.3.1, 1.3.2, 1.4.1, 1.4.3, 1.4.5, 2.1.1, 2.4.4, 2.4.6, 2.4.7, 3.1.1, 3.2.1, 3.2.2, 3.2.4, 3.3.2, 4.1.2 | 3: F-007 Touch targets too small or too close (2.5.8); F-010 Reading/focus order does not match what is shown (1.3.2); F-014 Page scrolls sideways at 320 px (1.4.10) |

Misses per method:

- **real-screen-reader (any):** 1.3.2, 1.4.1, 1.4.3, 1.4.5, 2.4.1, 2.4.2, 2.4.6, 3.1.1, 3.2.2, 3.2.4
- **real NVDA:** 1.3.2, 1.4.1, 1.4.3, 1.4.5, 2.4.1, 2.4.2, 2.4.6, 3.1.1, 3.2.2, 3.2.4
- **real VoiceOver:** 1.3.2, 1.4.1, 1.4.3, 1.4.5, 2.1.1, 2.4.1, 2.4.2, 2.4.6, 2.4.7, 3.1.1, 3.2.1, 3.2.2, 3.2.4
- **simulated screen reader:** 1.3.1, 1.3.2, 1.4.1, 1.4.3, 1.4.5, 2.1.1, 2.4.1, 2.4.2, 2.4.6, 2.4.7, 3.1.1, 3.2.1, 3.2.2, 3.2.4, 3.3.2
- **automated rules (axe):** 1.3.2, 1.4.1, 1.4.5, 2.1.1, 2.4.1, 2.4.2, 2.4.6, 2.4.7, 3.2.1, 3.2.2, 3.2.4
- **scripted suite without real SR:** 2.4.1, 2.4.2
- **everything (suite + real SR):** 2.4.1, 2.4.2

_After-page flags are candidates to review, not automatically false positives: the 2012 key predates WCAG 2.1/2.2, and the after page has known 2.2 gaps (for example reflow and target size)._

## Real screen-reader runs

| Screen reader + browser | Page | Passes (steps) | Ran fully | Transcript |
|---|---|---|---|---|
| NVDA 2026.3 + chromium 159.0.8154.6 | https://www.w3.org/WAI/demos/bad/after/home.html | headings 10, landmarks 2, formFields 3, buttons 2, links 50, graphics 7, tab 40 | yes | real-sr/nvda-chromium-www_w3_org_WAI_demos_bad_after_home_html.txt |
| NVDA 2026.3 + chromium 159.0.8154.6 | https://www.w3.org/WAI/demos/bad/before/home.html | headings 2, landmarks 1, formFields 2, buttons 1, links 50, graphics 11, tab 40 | yes | real-sr/nvda-chromium-www_w3_org_WAI_demos_bad_before_home_html.txt |
| NVDA 2026.3 + chromium 159.0.8154.6 | https://www.w3.org/WAI/demos/bad/before/tickets.html | headings 2, landmarks 1, formFields 2, buttons 1, links 45, graphics 10, tab 40 | yes | real-sr/nvda-chromium-www_w3_org_WAI_demos_bad_before_tickets_html.txt |
| VoiceOver macOS 15.8.2 + webkit 27.2 | https://www.w3.org/WAI/demos/bad/after/home.html | headings 13, landmarks 4, formFields 6, buttons 6, links 50, graphics 10, tab 40 | yes | real-sr/voiceover-webkit-www_w3_org_WAI_demos_bad_after_home_html.txt |
| VoiceOver macOS 15.8.2 + webkit 27.2 | https://www.w3.org/WAI/demos/bad/before/home.html | headings 5, landmarks 4, formFields 5, buttons 5, links 50, graphics 39, tab 16 | yes | real-sr/voiceover-webkit-www_w3_org_WAI_demos_bad_before_home_html.txt |
| VoiceOver macOS 15.8.2 + webkit 27.2 | https://www.w3.org/WAI/demos/bad/before/tickets.html | headings 5, landmarks 4, formFields 5, buttons 5, links 43, graphics 28, tab 16 | yes | real-sr/voiceover-webkit-www_w3_org_WAI_demos_bad_before_tickets_html.txt |
