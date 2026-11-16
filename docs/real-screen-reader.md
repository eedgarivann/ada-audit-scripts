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
| `tab` | Tab | Tab | `FOCUS-REMOVED` (2.4.7, 2.1.1, 3.2.1: focus falls to the page body, then resumes past skipped controls), `NO-NAME`, `FIELD-NO-LABEL`, `ERROR-NOT-ANNOUNCED`, `REPEAT` (2.1.2), `FOCUS-CHANGES-CONTEXT` (3.2.1) |

Each pass starts at the top of the page and stops when the screen reader says there is nothing more (`no next heading`), repeats itself, or reaches the pass's step cap. During the Tab pass the tool also records the focused element (selector, whether a field has a programmatic label, `aria-invalid`), so an unlabeled `<select>` that NVDA announces by its current value is still caught.

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

## Limits
- Speech is parsed from English NVDA/VoiceOver wording. Other speech languages are not supported yet.
- The step caps mean very long pages are sampled, not exhausted; the transcript shows where each pass ended and why.
- VoiceOver in WebKit and NVDA in Chromium can announce the same page differently. That is real-world variation, and the reason both run.
- Not covered: JAWS, Narrator, TalkBack, VoiceOver on iOS, braille output, live-region timing, and anything after a submission.
