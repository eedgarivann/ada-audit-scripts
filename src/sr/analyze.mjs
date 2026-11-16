// Pure analysis of a real screen-reader transcript (NVDA or VoiceOver, recorded by src/sr/driver.mjs).
// parsePhrase() turns one spoken announcement into {role, name, states, level}; analyzeTranscript() turns the
// passes into flags (rule codes in src/findings/rules.mjs, tool "real-sr"). No browser, no screen reader needed,
// so transcripts can be re-analysed anywhere (ada-audit report) and unit-tested on Linux.

// Role words, longest first. Each maps a spoken role to a normalised role.
const ROLE_WORDS = [
  ['navigation landmark', 'landmark'],
  ['banner landmark', 'landmark'],
  ['main landmark', 'landmark'],
  ['complementary landmark', 'landmark'],
  ['content info landmark', 'landmark'],
  ['contentinfo landmark', 'landmark'],
  ['content information landmark', 'landmark'],
  ['region landmark', 'landmark'],
  ['form landmark', 'landmark'],
  ['search landmark', 'landmark'],
  ['secure edit text', 'textbox'],
  ['search text field', 'textbox'],
  ['secure text field', 'textbox'],
  ['multi line edit', 'textbox'],
  ['clickable graphic', 'image'],
  ['visited link', 'link'],
  ['same page link', 'link'],
  ['toggle button', 'button'],
  ['menu button', 'button'],
  ['push button', 'button'],
  ['pop-up button', 'combobox'],
  ['popup button', 'combobox'],
  ['radio button', 'radio'],
  ['spin button', 'field'],
  ['text field', 'textbox'],
  ['edit text', 'textbox'],
  ['text area', 'textbox'],
  ['combo box', 'combobox'],
  ['list box', 'combobox'],
  ['check box', 'checkbox'],
  ['content info', 'landmark'],
  ['contentinfo', 'landmark'],
  ['complementary', 'landmark'],
  ['navigation', 'landmark'],
  ['banner', 'landmark'],
  ['landmark', 'landmark'],
  ['main', 'landmark'],
  ['region', 'landmark'],
  ['heading', 'heading'],
  ['link', 'link'],
  ['button', 'button'],
  ['edit', 'textbox'],
  ['combobox', 'combobox'],
  ['listbox', 'combobox'],
  ['checkbox', 'checkbox'],
  ['tickbox', 'checkbox'],
  ['slider', 'field'],
  ['spinbutton', 'field'],
  ['graphic', 'image'],
  ['image', 'image'],
];
const AMBIGUOUS = new Set(['main', 'region', 'navigation', 'banner', 'complementary', 'image', 'link', 'search', 'form']);
export const FIELD_ROLES = new Set(['textbox', 'combobox', 'checkbox', 'radio', 'field']);
const STATE_RE = [
  /^blank$/,
  /^(not |half )?checked$/,
  /^(collapsed|expanded)$/,
  /^has ?auto ?complete$/,
  /^has ?pop[- ]?up( \w+)?$/,
  /^invalid( entry| data)?$/,
  /^required$/,
  /^read ?only$/,
  /^(unavailable|dimmed|disabled)$/,
  /^(not )?selected$/,
  /^visited$/,
  /^clickable$/,
  /^level \d$/,
  /^multi ?line$/,
  /^(protected|editable|focused|busy|current( page)?)$/,
  /^(not )?pressed$/,
  /^(on|off)$/,
  /^out of (list|table|frame|landmark|\w+)$/,
  /^(list|menu|submenu)$/,
  /^\d+ of \d+$/,
  /^(list )?(with )?\d+ items?$/,
  /^(you are|to |press |use )/,
  /^insertion at end of text$/,
  /^end of text$/,
  /^landmark$/,
  /^(section|group|frame|document|web content)$/,
];
const FILENAME_RE = /(^|[\s/\\])[\w%~-]+\.(gif|jpe?g|png|svg|webp|bmp|ico|tiff?)(\b|$)|^[\w-]+_[\w-]+$|^https?:\/\//i;
const VAGUE_LINK_RE = /^(click here|here|more|read more|learn more|more info|more information|details|link|this|go|continue|click)[.!…]*$/i;
const GENERIC_ALT_RE = /^(image|graphic|picture|photo|spacer|img|icon|logo|banner|bullet|pic|blank|untitled)$/i;
const END_RE = /^(no next|no previous|no more|not found|no (heading|landmark|link|button|form field|graphic|control)s?\b)/i;

const clean = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:|-]+|[\s,.;:|]+$/g, '')
    .trim();

function roleOf(token, expect) {
  const t = token.toLowerCase();
  for (const [w, role] of ROLE_WORDS) {
    if (t === w || t === `${w} landmark`) return { role, word: w, heading: w === 'heading' };
    const lvl = /^heading level (\d)$/.exec(t);
    if (lvl) return { role: 'heading', word: 'heading', level: Number(lvl[1]) };
  }
  if (expect && t === 'search') return { role: 'landmark', word: 'search' };
  return null;
}

/**
 * Split one announcement into role, name, states. Works for NVDA ("heading, level 1, Title" / "Title  link")
 * and VoiceOver ("Title, heading level 1" / "link, Title") orders. Names that contain a role word are kept:
 * only one whole token is taken as the role, and ambiguous words ("main", "image") only when the pass expects them.
 * @param {string} phrase
 * @param {string[]} [expect] roles this pass expects, used to break ties
 */
export function parsePhrase(phrase, expect = []) {
  const text = clean(phrase);
  const out = { raw: String(phrase ?? ''), role: null, name: '', states: [], level: null, end: END_RE.test(text) };
  if (!text || out.end) return out;
  let tokens = String(phrase)
    .trim()
    .split(/\s*,\s*|\s{2,}|\s+\|\s+|\n/)
    .map(clean)
    .filter(Boolean);
  // "Title link" / "button Submit" with no separator: peel a leading or trailing role word off a single token.
  const expanded = [];
  const hasRoleToken = tokens.some((tk) => roleOf(tk, expect));
  for (const tk of tokens) {
    if (hasRoleToken || roleOf(tk, expect) || STATE_RE.some((r) => r.test(tk.toLowerCase()))) {
      expanded.push(tk);
      continue;
    }
    let done = false;
    for (const [w] of ROLE_WORDS) {
      if (AMBIGUOUS.has(w) && !expect.includes(ROLE_WORDS.find((x) => x[0] === w)[1])) continue;
      const lead = new RegExp(`^(${w}(?: level \\d)?)\\s+(.+)$`, 'i').exec(tk);
      const tail = new RegExp(`^(.+?)\\s+(${w}(?: level \\d)?)$`, 'i').exec(tk);
      if (lead && !tail) {
        expanded.push(lead[1], lead[2]);
        done = true;
        break;
      }
      if (tail) {
        expanded.push(tail[1], tail[2]);
        done = true;
        break;
      }
    }
    if (!done) expanded.push(tk);
  }
  tokens = expanded;
  const roleIdx = [];
  tokens.forEach((tk, i) => {
    const r = roleOf(tk, expect);
    if (r) roleIdx.push([i, r]);
  });
  // Prefer a role the pass expects; else the first unambiguous role; else the first role.
  const pick =
    roleIdx.find(([, r]) => expect.includes(r.role)) ||
    roleIdx.find(([, r]) => !AMBIGUOUS.has(r.word)) ||
    (roleIdx.length && tokens.length === 1 ? roleIdx[0] : null) ||
    roleIdx.find(([, r]) => r.role !== 'link' && r.role !== 'image') ||
    null;
  const used = new Set();
  if (pick) {
    const [i, r] = pick;
    out.role = r.role;
    if (r.level) out.level = r.level;
    used.add(i);
    // "visited, link" style: a second role word identical to the first is part of the role, not the name
    roleIdx.forEach(([j, r2]) => {
      if (j !== i && r2.role === r.role && r2.word === r.word) used.add(j);
      // a nested image inside a link/button ("link, graphic, logo.gif") is part of the role, not the name
      if (j !== i && r2.role === 'image' && (r.role === 'link' || r.role === 'button')) used.add(j);
    });
  }
  tokens.forEach((tk, i) => {
    if (used.has(i)) return;
    const low = tk.toLowerCase();
    const lvl = /^level (\d)$/.exec(low);
    if (lvl) {
      out.level = Number(lvl[1]);
      used.add(i);
      out.states.push(low);
      return;
    }
    if (STATE_RE.some((r) => r.test(low))) {
      out.states.push(low);
      used.add(i);
    }
  });
  out.name = clean(tokens.filter((_, i) => !used.has(i)).join(', '));
  return out;
}

const PASS_EXPECT = {
  headings: ['heading'],
  landmarks: ['landmark'],
  formFields: ['textbox', 'combobox', 'checkbox', 'radio', 'field', 'button'],
  buttons: ['button'],
  links: ['link'],
  graphics: ['image'],
  tab: ['link', 'button', 'textbox', 'combobox', 'checkbox', 'radio', 'field'],
};

/** The announcement for one step: the last non-empty phrase that parses to an expected role, else the last phrase. */
export function stepAnnouncement(step, pass) {
  const phrases = (step.phrases && step.phrases.length ? step.phrases : [step.last || '']).map(String);
  const expect = PASS_EXPECT[pass] || [];
  const parsed = phrases.map((p) => parsePhrase(p, expect)).filter((p) => p.raw.trim());
  if (!parsed.length) return parsePhrase('', expect);
  return [...parsed].reverse().find((p) => expect.includes(p.role)) || parsed[parsed.length - 1];
}

/** Trim the trailing run of identical announcements a pass ends on when the screen reader stops moving. */
function dedupeTail(items, endReason) {
  if (endReason !== 'repeat' || items.length < 2) return items;
  let k = items.length - 1;
  while (k > 0 && items[k - 1].a.raw === items[k].a.raw) k--;
  return items.slice(0, k + 1);
}

const short = (s, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Turn a transcript into flags. Each flag: {code, pass, step, target, detail, spoken, confidence}
 * @param {object} t transcript object written by the driver (schema "ada-real-sr/1")
 */
export function analyzeTranscript(t) {
  const flags = [];
  const stats = {};
  const passes = Object.fromEntries((t.passes || []).map((p) => [p.pass, p]));
  const sr = t.screenReader?.name || 'screen reader';
  const add = (code, pass, step, detail, extra = {}) =>
    flags.push({ code, pass, step: step ?? null, detail: `${code} [${sr}] ${detail}`.slice(0, 400), target: null, ...extra });
  const itemsOf = (pass) => {
    const p = passes[pass];
    if (!p || p.error) return null;
    const items = (p.steps || []).map((s, i) => ({ s, i: i + 1, a: stepAnnouncement(s, pass) })).filter((x) => !x.a.end && x.a.raw.trim());
    return dedupeTail(items, p.endReason);
  };

  // Headings
  const hs = itemsOf('headings');
  if (hs) {
    const heads = hs.filter((x) => x.a.role === 'heading');
    stats.headings = heads.length;
    if (!heads.length) add('NO-HEADINGS', 'headings', null, 'heading quick-nav found no headings on the page');
    let prev = 0;
    for (const h of heads) {
      if (!h.a.name) add('EMPTY-HEADING', 'headings', h.i, `heading announced with no text: "${short(h.a.raw)}"`, { spoken: h.a.raw });
      if (h.a.level && prev && h.a.level > prev + 1)
        add('HEADING-SKIP', 'headings', h.i, `level ${prev} -> ${h.a.level}: "${short(h.a.raw)}"`, { spoken: h.a.raw });
      if (h.a.level) prev = h.a.level;
    }
    if (heads.length && heads.every((h) => h.a.level && h.a.level !== 1)) add('NO-H1', 'headings', null, 'no level-1 heading announced');
  }
  // Landmarks
  const ls = itemsOf('landmarks');
  if (ls) {
    stats.landmarks = ls.length;
    if (!ls.some((x) => /\bmain\b/i.test(x.a.raw)))
      add('NO-MAIN', 'landmarks', null, `landmark quick-nav found ${ls.length} landmark(s), none of them main`);
  }
  // Tab pass (keyboard focus + what was spoken + DOM facts at that moment)
  const tab = passes.tab && !passes.tab.error ? passes.tab : null;
  const tabSteps = tab ? (tab.steps || []).map((s, i) => ({ s, i: i + 1, a: stepAnnouncement(s, 'tab') })) : [];
  if (tab) stats.tabStops = tabSteps.length;
  const firstStops = tabSteps.slice(0, 3);
  const hasSkip = firstStops.some((x) => /\bskip\b|jump to|go to (main )?content/i.test(`${x.a.name} ${x.s.dom?.name || ''}`));
  if (hs && ls && stats.headings === 0 && stats.landmarks === 0 && tab && !hasSkip)
    add(
      'NO-BYPASS',
      'landmarks',
      null,
      'no headings, no landmarks and no skip link in the first Tab stops: nothing lets a screen-reader user jump past repeated blocks',
    );

  // Fields: quick-nav announcements, plus Tab stops where the DOM shows no programmatic label.
  const fs = itemsOf('formFields');
  const seenField = new Set();
  if (fs) {
    stats.formFields = fs.filter((x) => FIELD_ROLES.has(x.a.role)).length;
    for (const f of fs) {
      if (!FIELD_ROLES.has(f.a.role)) continue;
      if (!f.a.name) {
        seenField.add(f.a.raw);
        add('FIELD-NO-LABEL', 'formFields', f.i, `${f.a.role} announced with no label: "${short(f.a.raw)}"`, { spoken: f.a.raw });
      }
    }
  }
  for (const x of tabSteps) {
    const d = x.s.dom || {};
    const isField = /^(input|select|textarea)$/.test(d.tag || '') && !/^(submit|button|reset|image|hidden)$/.test(d.type || '');
    if (isField && d.hasLabel === false && !seenField.has(x.a.raw)) {
      seenField.add(x.a.raw);
      add(
        'FIELD-NO-LABEL',
        'tab',
        x.i,
        `${d.tag}${d.type ? '[' + d.type + ']' : ''} has no programmatic label; ${sr} said "${short(x.a.raw)}"${x.a.name ? ' (that text comes from its value or placeholder, not a label)' : ''}`,
        { target: d.selector || null, spoken: x.a.raw },
      );
    }
    if (d.invalid && !/invalid/.test(x.a.raw.toLowerCase()))
      add('ERROR-NOT-ANNOUNCED', 'tab', x.i, `field is aria-invalid but ${sr} did not say so: "${short(x.a.raw)}"`, {
        target: d.selector || null,
        spoken: x.a.raw,
      });
  }
  if ((stats.formFields || tabSteps.some((x) => /^(input|select|textarea)$/.test(x.s.dom?.tag || ''))) && !t.readOnlyErrorsTested)
    add(
      'ERRORS-NOT-TESTED',
      'formFields',
      null,
      'error messages were not triggered: read-only runs never submit forms. Test errors on a staging copy.',
    );

  // Buttons
  const bs = itemsOf('buttons');
  if (bs) {
    const btns = bs.filter((x) => x.a.role === 'button');
    stats.buttons = btns.length;
    for (const b of btns)
      if (!b.a.name) add('NO-NAME', 'buttons', b.i, `button announced with no name: "${short(b.a.raw)}"`, { spoken: b.a.raw });
  }
  // Links
  const lk = itemsOf('links');
  if (lk) {
    const links = lk.filter((x) => x.a.role === 'link');
    stats.links = links.length;
    for (const l of links) {
      if (!l.a.name) add('NO-NAME', 'links', l.i, `link announced with no name: "${short(l.a.raw)}"`, { spoken: l.a.raw });
      else if (FILENAME_RE.test(l.a.name))
        add('LINK-FILENAME', 'links', l.i, `link announced as a file name or URL: "${short(l.a.raw)}"`, { spoken: l.a.raw });
      else if (VAGUE_LINK_RE.test(l.a.name))
        add('VAGUE-LINK', 'links', l.i, `link text gives no purpose out of context: "${short(l.a.raw)}"`, { spoken: l.a.raw });
    }
  }
  // Graphics
  const gs = itemsOf('graphics');
  if (gs) {
    const imgs = gs.filter((x) => x.a.role === 'image');
    stats.graphics = imgs.length;
    for (const g of imgs) {
      if (!g.a.name)
        add('IMG-NO-ALT', 'graphics', g.i, `graphic announced with no text alternative: "${short(g.a.raw)}"`, { spoken: g.a.raw });
      else if (FILENAME_RE.test(g.a.name))
        add('IMG-FILENAME', 'graphics', g.i, `graphic announced by file name: "${short(g.a.raw)}"`, { spoken: g.a.raw });
      else if (GENERIC_ALT_RE.test(g.a.name))
        add('IMG-VAGUE-ALT', 'graphics', g.i, `graphic announced with a generic name: "${short(g.a.raw)}"`, { spoken: g.a.raw });
    }
  }
  // Tab focus problems
  let run = 0;
  for (let k = 0; k < tabSteps.length; k++) {
    const x = tabSteps[k];
    const d = x.s.dom || {};
    if (d.none || d.tag === 'body')
      add('FOCUS-LOST', 'tab', x.i, `Tab ${x.i}: keyboard focus fell to the page body; ${sr} said "${short(x.a.raw) || '(nothing)'}"`, {
        spoken: x.a.raw,
      });
    else if (d.tag && !x.a.name && !d.name && x.a.role !== 'image')
      add('NO-NAME', 'tab', x.i, `Tab ${x.i}: ${d.tag} focused and announced with no name: "${short(x.a.raw)}"`, {
        target: d.selector || null,
        spoken: x.a.raw,
      });
    if (d.navigated)
      add('FOCUS-CHANGES-CONTEXT', 'tab', x.i, `Tab ${x.i}: moving focus loaded a new page (${d.url})`, { target: d.selector || null });
    const prevSel = tabSteps[k - 1]?.s.dom?.selector;
    run = d.selector && d.selector === prevSel ? run + 1 : 0;
    if (run === 2)
      add('REPEAT', 'tab', x.i, `REPEAT(trap?) Tab ${x.i}: focus stayed on ${d.selector} for 3 presses`, { target: d.selector });
  }
  // Passes that failed or could not run are reported as errors, never as clean results.
  const errors = (t.passes || []).filter((p) => p.error).map((p) => `${sr} ${p.pass} pass on ${t.url} did not run: ${p.error}`);
  if (t.error) errors.push(`${sr} run on ${t.url} failed: ${t.error}`);
  return { flags, stats, errors };
}
