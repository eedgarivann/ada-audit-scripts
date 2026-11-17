# Using the report: from findings to fixed

The report is built to be worked through top to bottom. This guide is the process we recommend; it follows WCAG-EM (W3C's evaluation methodology) and keeps the claims you make honest.

## 1. Before you run: choose the sample and the journeys
- List the **critical user journeys**: what people must be able to do (buy, book, donate, contact, sign up, pay a bill, read a policy). Pass each as `--journey "Name=start-url,step-url,…"`. Pages on a journey are prioritized; without journeys every page is treated as critical and the report says so.
- Pick **3 or more pages per template** (home, a listing, a detail page, an article, a form) plus every step of each journey. Shared problems then show up as *multi-page*, which means one template fix.
- Run on **staging** when you can, with `--try-empty-submit` for forms; live sites stay read-only (writes are blocked), so server-side errors are listed as *not tested*.
- Set `--platform` so each card shows your platform's steps first.

## 2. Read the executive summary, then the fix plan
- **Fix now** — barriers that can stop someone finishing a critical journey (blocker/critical in the top three priority rungs, on a journey, from a deterministic or reviewed check). Assign these first, ideally this sprint.
- **Quick wins** — failures that take under an hour (often content or a setting: alt text, a label, `lang`, a skip link). Do them in the same pass; they visibly reduce barriers fast.
- **Fix next** — everything else that fails WCAG A/AA, ordered by score. Template-wide items (`multi-page`) usually give the most value per hour.
- **Monitor** — unconfirmed cues and non-failures. Re-check after the main fixes.
- **Best practice / AAA / advisory** — listed separately and never counted as AA failures. Do them if they help your users; never present them as legal requirements.

## 3. Work each finding card
1. **Confirm it.** Open the URL, find the element (the selector in *Where*), look at the screenshot and the evidence line. `needs-review` and `inferred` items must be confirmed by a person before you report or fix them; `automated-certain` items are deterministic but still worth a glance (a tool can catch a transient state).
2. **Fix the cause, not the instance.** If it is multi-page, fix the template, theme section or component once. Use the numbered steps and the before/after code; the platform section names where that setting usually lives.
3. **Verify** with the card's *How to verify* step: the same keyboard, zoom, contrast or screen-reader check a person would do. Then re-run the tool (`npx ada-audit … --tools axe,forms`) to see the candidate disappear.
4. **Share it.** `report.pdf` is the deliverable for owners and clients (cover, summary, top barriers with screenshots, fix plan, findings table, fix cards, limits). Use `--paper letter` for US Letter.
5. **Track it.** Use the `fingerprint` (stable across runs) or import `findings.csv` into your tracker; SARIF goes straight into GitHub code scanning.

## 4. Do the manual checks
Section 7 lists what automation cannot judge, priority items first (for example, server-side errors on journey forms, a real screen-reader pass with NVDA/JAWS, VoiceOver and TalkBack, keyboard-only journeys, alt text quality, zoom to 400 %). Record assistive technology, browser, OS and versions. Simulated screen-reader output and simulated persona journeys point you to where to look; they are not testing with assistive technology or with disabled people.

## 5. Re-run and report honestly
- Re-run the same sample after fixes. Compare fingerprints: fixed, still open, new.
- Use the report's **evaluation statement** wording: what was tested (pages, date, method, tools and versions) and what was found. Never write "compliant", "conformant", "certified" or "ADA-proof".
- Do not add an accessibility overlay widget: it does not fix the code and is not a substitute for these fixes.
- Plan ongoing checks: add `ada-audit --fail-on serious` to CI on staging, and re-audit after redesigns, theme updates or new journeys.

## What the labels mean
| Label | Meaning |
|---|---|
| Severity **blocker** | someone cannot complete the task (for example, a simulated keyboard user got stuck) |
| **critical** | very hard or risky to complete (unlabeled checkout field, missing alt on a product image) |
| **serious** | real friction (low contrast, focus hidden) |
| **moderate / minor** | inconvenience; still a candidate failure if the kind is *failure* |
| Confidence **automated-certain** | a deterministic rule (axe-core violation, a DOM fact) |
| **needs-review** | heuristic: plausible, a person must confirm |
| **inferred** | a cue or a root-cause guess; confirm before reporting |
| **Corroborated** | two or more independent tools found it |
| Effort **low / medium / high** | under 1 h / hours to a day / days or vendor work |
