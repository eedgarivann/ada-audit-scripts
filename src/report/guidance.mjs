// Plain-language guidance shared by every report format: methods sentence, conformance wording,
// executive summary, and the manual-testing checklist for what automation cannot cover.
const TOOL_METHOD = {
  axe: (v) => `automated rules (axe-core ${v.axe || '4.x'})`,
  'tab-walk': () => 'a scripted keyboard Tab walk',
  'focus-state': () => 'scripted focus/hover state capture',
  'menu-modal': () => 'scripted menu/dialog keyboard tests',
  forms: () => 'form inspection (labels, autocomplete, required, client-side errors)',
  inventory: () => 'DOM inventory (language, headings, landmarks, images)',
  reflow: () => 'reflow at 320 px and text-spacing checks',
  motion: () => 'motion and reduced-motion checks',
  'sr-transcript': (v) => `a simulated screen reader (Guidepup Virtual Screen Reader ${v.vsr || ''})`.replace(/ \)$/, ')'),
  'context-change': () => 'context-change tests (focus and input)',
  'sample-compare': () => 'cross-page consistency checks',
  'bypass-order': () => 'skip-link and reading-order checks',
  journeys: () => 'simulated persona journeys (scripted models, not real users)',
  'real-sr': (v) =>
    `real screen readers (${v.realScreenReaders || 'NVDA/VoiceOver'}) driven by Guidepup ${v.guidepup || ''}`.replace(/ $/, ''),
};

export function methodsSentence(run) {
  const v = run.versions || {};
  const parts = (run.tools || []).map((t) => (TOOL_METHOD[t] || (() => t))(v));
  const widths = run.widths?.length ? ` at ${run.widths.join(' and ')} px` : '';
  const real = (run.tools || []).includes('real-sr');
  const tail = real
    ? 'The real screen-reader passes are scripted (headings, landmarks, fields, buttons, links, graphics, Tab); no human listened, JAWS and TalkBack were not run, and there was no testing with disabled users.'
    : 'No real screen reader (JAWS, NVDA, VoiceOver, TalkBack) and no testing with disabled users.';
  return `${parts.join('; ')}, in headless Chromium (Playwright ${v.playwright || '?'})${widths}. ${tail}`;
}

export function conformanceStatement(doc) {
  const s = doc.summary,
    run = doc.run;
  const date = (run.finishedAt || run.startedAt || '').slice(0, 10);
  const scope = `${run.pages.length} page${run.pages.length === 1 ? '' : 's'} listed in Scope`;
  const methods = methodsSentence(run);
  if (s.failures === 0)
    return `No WCAG 2.2 Level A/AA failures were found on the ${scope}, using ${methods} Date: ${date}. This is not a conformance claim: automated and simulated checks cover only part of WCAG, and the manual checks listed in this report are still required.`;
  const confirmed = s.failuresConfirmedByRules;
  return `${s.failures} candidate WCAG 2.2 Level A/AA failure${s.failures === 1 ? '' : 's'} (${confirmed} detected by deterministic automated rules, ${s.failures - confirmed} needing human review) were found on the ${scope}, using ${methods} Date: ${date}. ${confirmed ? 'At least one rule-confirmed failure means these pages do not currently meet WCAG 2.2 AA.' : 'If any candidate is confirmed, these pages do not meet WCAG 2.2 AA.'} Do not describe the site as "compliant" or "conformant".`;
}

const PLAIN_SEV = {
  blocker: 'stops people completing the task',
  critical: 'makes the task very hard or risky',
  serious: 'causes real friction',
  moderate: 'is an annoyance with a workaround',
  minor: 'is polish',
};
export function executiveSummary(doc) {
  const f = doc.findings.filter((x) => x.kind === 'failure');
  const top = f.slice(0, 5);
  const s = doc.summary;
  const lines = [];
  lines.push(
    s.failures
      ? `We found ${s.failures} candidate accessibility barrier${s.failures === 1 ? '' : 's'} across ${s.pagesWithFindings} page${s.pagesWithFindings === 1 ? '' : 's'} (${s.failuresConfirmedByRules} detected by deterministic rules, ${s.failures - s.failuresConfirmedByRules} needing a quick human check): ${s.byPlan['fix-now']} to fix now, ${s.byPlan['fix-next']} next, ${s.byPlan.monitor} to monitor. ${s.quickWins} are quick wins (under an hour each). Start with the "Fix now" list: those barriers can stop people finishing a key task.`
      : 'No likely WCAG A/AA barriers were detected by the automated and simulated checks. Manual testing is still required before drawing any conclusion.',
  );
  const journeys = doc.journeys || [];
  const blocked = journeys.filter((j) => /stuck|gave up/.test(j.outcome));
  if (blocked.length)
    lines.push(
      `Simulated journeys: ${blocked.map((j) => `${j.personaLabel} ${j.outcome} on ${shortUrl(j.url)}`).join('; ')}. These are scripted models, so confirm by hand, but they point to where real users are most likely to fail.`,
    );
  return {
    lead: lines,
    top: top.map((x) => ({
      id: x.id,
      title: x.title,
      who: x.impact.who,
      effect: PLAIN_SEV[x.severity],
      plan: x.priority.plan,
      effort: x.effort,
      sc: x.wcag.map((w) => w.sc).join(', '),
      pages: x.pages,
      confidence: x.confidence,
    })),
  };
}
export function shortUrl(u) {
  try {
    const x = new URL(u);
    return x.pathname + x.search || '/';
  } catch {
    return u || '';
  }
}

/** Manual checks automation cannot do; conditional items appear when the run saw a reason for them. */
export function manualChecklist(doc) {
  const has = (pred) => doc.findings.some(pred);
  const tools = new Set(doc.run.tools || []);
  const items = [
    {
      sc: '2.1.1, 2.1.2, 2.4.3, 2.4.7',
      check:
        'Complete every critical journey with the keyboard only (Tab, Shift+Tab, Enter, Space, arrows, Esc). Note any control you cannot reach, operate or leave.',
    },
    {
      sc: '1.1.1, 1.3.1, 4.1.2, 4.1.3',
      check: tools.has('real-sr')
        ? 'Listen to the real screen-reader transcripts (real-sr/*.txt) and confirm each flagged announcement by ear. Then finish what the scripted passes cannot: complete each journey end to end (including errors and status messages on a staging copy) with JAWS, VoiceOver on iOS and TalkBack, and record AT, browser, OS and versions.'
        : 'Real screen reader pass on each journey: NVDA or JAWS with Chrome (Windows), VoiceOver with Safari (macOS and iOS), TalkBack with Chrome (Android). Listen to headings, landmarks, form labels, errors and status messages. Record AT, browser, OS and versions.',
    },
    {
      sc: '1.1.1',
      check:
        'Judge alt text quality against the actual images (inventory *_images.html review sheet): does each alt convey what the image means here?',
    },
    {
      sc: '1.4.3, 1.4.11',
      check: 'Check contrast of text over images, gradients and video, and of icons, input borders and focus rings, on rendered pixels.',
    },
    {
      sc: '1.4.4, 1.4.10',
      check: 'Zoom to 200% and 400% in a real browser at 1280 px: nothing is cut off and no sideways scrolling for text content.',
    },
    { sc: '1.3.3, 1.4.1', check: 'Instructions do not rely on shape, colour, size or position alone ("click the green button").' },
    { sc: '1.4.13', check: 'Hover/focus pop-ups (tooltips, menus) can be dismissed with Esc, hovered over, and stay until dismissed.' },
    { sc: '2.5.3', check: 'Voice control ("click Add to cart") works: accessible names start with the visible label.' },
    { sc: '3.2.6', check: 'Help and contact options appear in the same relative place on every page that has them.' },
    { sc: '3.3.4', check: 'Purchases, bookings and legal submissions can be reviewed, corrected or reversed before they are final.' },
    { sc: '1.2.x', check: 'Video and audio on journeys have accurate captions, transcripts and audio description where needed.' },
    { sc: '-', check: 'PDFs and documents linked from journeys are tagged and readable (or have an accessible HTML alternative).' },
  ];
  if (has((f) => f.tools.includes('forms')) || tools.has('forms'))
    items.unshift({
      sc: '3.3.1, 3.3.3, 4.1.3',
      check:
        'On staging or with one owner-approved test entry: submit each journey form empty and with invalid values. Errors must be text, linked to the field, announced, and focus must move to them. Read-only runs cannot test server-side errors.',
      priority: true,
    });
  if (has((f) => /captcha|paste-blocked/.test(f.remediation.concept)))
    items.unshift({
      sc: '3.3.8',
      check: 'Log in and complete any CAPTCHA or code step with a password manager, keyboard only, and a screen reader.',
      priority: true,
    });
  if (has((f) => f.remediation.concept === 'keyboard-trap' || f.remediation.concept === 'menu-dialog'))
    items.unshift({
      sc: '2.1.2',
      check: 'Confirm each reported trap/menu issue by hand twice (scripted results can be flaky); note browser and version.',
      priority: true,
    });
  if (has((f) => f.tools.includes('journeys')))
    items.unshift({
      sc: '-',
      check:
        'Re-walk each journey a simulated persona failed, as that kind of user would (keyboard only; screen reader; 320 px + 200% text; large touch targets).',
      priority: true,
    });
  if (has((f) => f.remediation.concept === 'time-limit'))
    items.unshift({
      sc: '2.2.1',
      check: 'Leave the page idle past any time limit: there must be a warning and a way to extend.',
      priority: true,
    });
  items.push(
    { sc: '3.3.7', check: 'Multi-step processes do not ask again for information already given.' },
    { sc: '2.5.7', check: 'Every drag action (sliders, sortable lists, maps) has a single-tap alternative.' },
  );
  return items;
}

export const NOT_TESTED = [
  'Logged-in areas, payments and anything behind a submission (read-only by design).',
  'Server-side form validation and error handling (needs staging or an owner-approved test entry).',
  'Real screen readers and other assistive technology; testing with disabled users.',
  'Native mobile apps, PDFs and documents, canvas or WebGL content, media captions quality.',
];
/** NOT_TESTED for this run: when real screen readers ran, say exactly what they did not cover. */
export function notTestedFor(run = {}) {
  if (!(run.tools || []).includes('real-sr')) return NOT_TESTED;
  return NOT_TESTED.map((t) =>
    t.startsWith('Real screen readers')
      ? 'Screen readers beyond the scripted NVDA/VoiceOver passes (JAWS, TalkBack, VoiceOver on iOS), a human listening end to end, and testing with disabled users.'
      : t,
  );
}
/** Rows for the "Real screen-reader runs" section. */
export function realSrRows(doc) {
  return (doc.realScreenReader || []).map((r) => ({
    who: `${r.screenReader}${r.screenReaderVersion ? ' ' + r.screenReaderVersion : ''} + ${r.browser}${r.browserVersion ? ' ' + r.browserVersion : ''}`,
    url: r.url,
    passes: r.passes.map((p) => `${p.pass} ${p.error ? 'FAILED' : p.steps}`).join(', '),
    ok: r.ok,
    transcript: r.transcript,
  }));
}

/**
 * Pick the most specific screenshot for a finding (element crop > journey step > viewport) and describe it.
 * Returns null when the finding has none. Alt text says what the image shows; it never claims more than the tool captured.
 * @returns {{file:string, alt:string, caption:string}|null}
 */
export function keyScreenshot(f) {
  // Works on tool output paths (tab-walk/…) and on flattened copies (tab-walk__…).
  const rank = (s) => (/(^|[\\/])tab-walk(__|[\\/])/.test(s) ? 0 : /(^|[\\/])journeys(__|[\\/])/.test(s) ? 1 : 2);
  const px = (s) => Number((/_(\d{3,4})(?:[\\/]|__|\.png$)/.exec(s) || [])[1] || 9999);
  // Most specific first; then the narrowest (mobile-first) capture.
  const shots = f.locations
    .flatMap((l) => l.screenshots.map((s) => ({ s, l })))
    .sort((a, b) => rank(a.s) - rank(b.s) || px(a.s) - px(b.s) || a.s.localeCompare(b.s));
  if (!shots.length) return null;
  const { s, l } = shots[0];
  const width = (/_(\d{3,4})(?:[\\/]|__|\.png$)/.exec(s) || [])[1] || (rank(s) === 1 ? '' : l.widths[0]) || '';
  const where = `${shortUrl(l.url) || 'the page'}${width ? ` at ${width} px wide` : ''}`;
  const kind =
    rank(s) === 0
      ? 'Cropped screenshot of the focused control'
      : rank(s) === 1
        ? 'Screenshot from a simulated persona journey'
        : 'Viewport screenshot';
  const alt = `${kind} on ${where}${l.target && rank(s) === 0 ? `, element ${l.target}` : ''}, captured for: ${f.title}.`;
  return { file: s, alt, caption: `${f.id}: ${kind.toLowerCase()} (${where}). Confirm the barrier on the live page.` };
}
