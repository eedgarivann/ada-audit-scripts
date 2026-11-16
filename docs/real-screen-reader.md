# Real screen-reader runs (NVDA and VoiceOver)

`ada-audit sr` drives a **real** screen reader, NVDA on Windows or VoiceOver on macOS, through [Guidepup](https://www.guidepup.dev/), records everything it says while it walks a journey, and turns what it heard into findings. This is a different method from the simulated screen reader (`sr-transcript`, Guidepup Virtual Screen Reader), and the findings say so: `methods: ["real-screen-reader"]` versus `"simulated-screen-reader"`, and every evidence line names the screen reader (`[NVDA]` / `[VoiceOver]`).

It is still **scripted**. A program presses the keys and reads the speech log; no person listens, nothing is judged by ear, and JAWS, TalkBack and VoiceOver on iOS are not covered. Treat the output as strong evidence to confirm, not as user testing.

## What a run does
For each page in the journey, in a headed browser (NVDA + Chromium, VoiceOver + WebKit by default):

| Pass | NVDA keys | VoiceOver command | Flags it can raise |
|---|---|---|---|
| `headings` | H | VO-Cmd-H | `NO-HEADINGS` (1.3.1), `EMPTY-HEADING` (1.3.1, 2.4.6), `HEADING-SKIP`, `NO-H1` (best practice) |
| `landmarks` | D | find next landmark | `NO-MAIN` (advisory); with no headings, no landmarks and no skip link: `NO-BYPASS` (2.4.1) |
| `formFields` | F | VO-Cmd-J (next control) | `FIELD-NO-LABEL` (1.3.1, 3.3.2, 4.1.2), `ERRORS-NOT-TESTED` (not tested) |
| `buttons` | B | find next button | `NO-NAME` (4.1.2) |
| `links` | K | VO-Cmd-L | `NO-NAME` (4.1.2), `LINK-FILENAME` (2.4.4, 1.1.1), `VAGUE-LINK` (2.4.4), `DUPLICATE-LINK-NAMES` (2.4.4; inferred unless the Tab pass saw different targets) |
| `graphics` | G | VO-Cmd-G | `IMG-NO-ALT`, `IMG-FILENAME` (1.1.1), `IMG-VAGUE-ALT` (1.1.1, inferred) |
| `tab` | Tab | Option-Tab in WebKit (plain Tab skips links there), Tab elsewhere | `FOCUS-REMOVED` (2.4.7, 2.1.1, 3.2.1: focus falls to the page body, then resumes past skipped controls), `NO-NAME`, `FIELD-NO-LABEL`, `ERROR-NOT-ANNOUNCED`, `REPEAT` (2.1.2), `FOCUS-CHANGES-CONTEXT` (3.2.1) |

Each pass starts at the top of the page and stops when NVDA says there is nothing more (`no next heading`), when VoiceOver stalls (4 steps in a row with nothing new: silence, a phrase already heard, `Last …`, `… not found`; NVDA allows 12), when the Tab order wraps back to its first stop, at the pass's step cap, or at its time budget (`--pass-timeout`, default 240 s; `--page-timeout`, default 900 s). Every screen-reader command also has a 30 s timeout, so a stuck command fails that pass instead of hanging the job. During the Tab pass the tool also records the focused element (selector, whether a field has a programmatic label, `aria-invalid`), so an unlabeled `<select>` that NVDA announces by its current value is still caught.

**Read-only.** Passes only move the screen-reader cursor or press Tab. Nothing is activated, typed or submitted, and the browser context aborts every non-GET request. That is why error messages are reported as `ERRORS-NOT-TESTED`: hearing them needs a submission, which belongs on a staging copy.

Anything that fails to run (a pass, a page, the whole screen reader) is listed in `findings.json` `errors` and shown as "Ran fully: no" in the report. A failed pass is missing evidence, never a clean result.

## Output
- `real-sr/<sr>-<browser>-<page>.txt`: the transcript a person can read, one line per step: what was spoken, and for Tab the focused element.
- `real-sr/<sr>-<browser>-<page>.json`: the same, machine-readable (`schema: "ada-real-sr/1"`). Findings are rebuilt from these files every time (`ada-audit report <dir>`), so improvements to the analysis apply to old transcripts.
- `findings.json` gains `realScreenReader[]` (one row per transcript), `run.tools` includes `real-sr`, `run.versions` records Guidepup and the screen readers, and each finding lists its `methods`. Reports get a "Real screen-reader runs" section.

## Running it

### On GitHub Actions (any OS, recommended)
The workflow [`.github/workflows/screen-readers.yml`](../.github/workflows/screen-readers.yml) runs NVDA on `windows-2025` and VoiceOver on `macos-15`, then a Linux job runs the regular suite on the same pages, merges the transcripts into one `findings.json` and scores it against the W3C BAD answer key (`scripts/bench-bad.mjs`). Start it from the Actions tab ("Real screen readers" → Run workflow) and pick a journey file. Artifacts: `real-sr-nvda-chromium`, `real-sr-voiceover-webkit`, `bench-bad-merged`.

### On your own Windows or Mac
```sh
npx @guidepup/setup setup        # once per machine; on a Mac it walks you through the VoiceOver permissions
npm ci && npx playwright install chromium webkit
npx @guidepup/setup install      # screen-reader assets for this Guidepup version
npx ada-audit sr --url https://example.org/contact --journey examples/sr-journey.json -o audit-output
```
The screen reader takes over the keyboard and speech while it runs: leave the machine alone until it finishes. On Linux `ada-audit sr` exits with code 2 and points you to the workflow.

### Journey files
```json
{
  "name": "Contact page: can a screen-reader user find the form and hear every label?",
  "urls": ["https://example.org/contact"],
  "steps": ["headings", "landmarks", "formFields", "buttons", { "pass": "links", "max": 80 }, "graphics", "tab"],
  "max": 40
}
```
`--url` (repeatable) replaces `urls`; `--max` caps every pass. Without `--journey` all seven passes run with default caps.

Exit codes: 0 ok, 2 usage or no screen reader on this OS, 3 a page or pass failed (transcripts and reports are still written).

## Merging with a full audit
Run the suite and the screen reader into the same folder in either order, then rebuild:
```sh
npx ada-audit https://example.org/contact -o out
npx ada-audit sr --url https://example.org/contact -o out   # on Windows/macOS, or copy real-sr/ from the workflow artifact
npx ada-audit report out
```
`ada-audit run` never deletes `real-sr/`. One barrier found by both the scripts and the real screen reader becomes one finding marked *corroborated*, with both methods listed.

## Benchmark: W3C BAD demo (16 Nov 2026)
Workflow run [43809005716](https://github.com/eedgarivann/ada-audit-scripts/actions/runs/43809005716) on `before/home`, `after/home` and `before/tickets`: NVDA 2026.3 + Chromium 159 on windows-2025 (about 3 min), VoiceOver on macOS 15.8.2 + WebKit 27.2 on macos-15 (about 9 min). Every pass ran on all 6 page/screen-reader pairs. Scored against W3C's report for the inaccessible home page (18 A/AA criteria marked Fail, 4.1.1 excluded; `bench/bad-home-answer-key.json`, `scripts/bench-bad.mjs`). A method only gets credit for criteria its own rules map to.

| Evidence method | SC recall (of 18) | Of the 13 a listener can notice | Flags on the after page |
|---|---|---|---|
| real NVDA | 8 (44%) | 62% | 0 |
| real VoiceOver | 5 (28%) | 38% | 0 |
| real screen readers (either) | 8 (44%): 1.1.1, 1.3.1, 2.1.1, 2.4.4, 2.4.7, 3.2.1, 3.3.2, 4.1.2 | 62% | 0 |
| simulated screen reader (`sr-transcript`) | 3 (17%) | 23% | 0 |
| axe-core | 7 (39%) | 46% | 1 |
| scripted suite without real SR | 16 (89%) | 85% | 3 |
| suite + real SR | 16 (89%) | 85% | 3 |

Saved copies: [benchmark](real-sr-sample/bench-bad.md), [NVDA transcript](real-sr-sample/nvda-chromium-www_w3_org_WAI_demos_bad_before_home_html.txt), [VoiceOver transcript](real-sr-sample/voiceover-webkit-www_w3_org_WAI_demos_bad_before_home_html.txt) (before/home).

What this means: real screen readers find far more than the simulated one (8 vs 3 criteria) and add independent, audible corroboration to 8 suite findings, with no flags on the fixed page. They did not add new criteria to the full suite. Both miss 2.4.1 (the demo's W3C wrapper has a skip link, so the page sounds bypassable) and 2.4.2 (the title is spoken but whether it describes the page is a human judgement). VoiceOver missed the focus problems NVDA caught (2.1.1, 2.4.7, 3.2.1) because WebKit's Option-Tab order differs and focus fell to the page body only at the end of the order. One benchmark page, tuned with the answers visible: not a promise for other sites.

## Limits
- Speech is parsed from English NVDA/VoiceOver wording. Other speech languages are not supported yet.
- The step caps mean very long pages are sampled, not exhausted; the transcript shows where each pass ended and why.
- VoiceOver in WebKit and NVDA in Chromium can announce the same page differently. That is real-world variation, and the reason both run.
- Not covered: JAWS, Narrator, TalkBack, VoiceOver on iOS, braille output, live-region timing, and anything after a submission.
