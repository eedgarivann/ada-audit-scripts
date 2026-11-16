// Pure analysis of a real screen-reader transcript (NVDA or VoiceOver, recorded by src/sr/driver.mjs).
// parsePhrase() turns one spoken announcement into {role, name, states, level}; analyzeTranscript() turns the
// passes into flags (rule codes in src/findings/rules.mjs, tool "real-sr"). No browser, no screen reader needed,
// so transcripts can be re-analysed anywhere (ada-audit report) and unit-tested on Linux.

// Role words, longest first. Each maps a spoken role to a normalised role.
const ROLE_WORDS = [
  ['unlabeled graphic', 'image'],
  ['unlabelled graphic', 'image'],
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
  ['pop up button', 'combobox'],
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
  /^(section|group|frame|document|web content|table|row|cell|article|paragraph|clickable|same page)$/,
  /^(row|column) \d+$/,
  /^table with \d+ rows? and \d+ columns?$/,
  /^(in|out of) (table|list|frame|form)$/,
];
// Spoken hints that are not part of the announcement (NVDA 2025+ image-description hint, object replacement char).
const NOISE_RE = [/To get missing image descriptions,? open the context menu\.?/gi, /\uFFFC/g, /^You are currently on .*$/is];
const FILENAME_RE =
  /(^|[\s/\\])[\w%~-]+\.(gif|jpe?g|png|svg|webp|bmp|ico|tiff?|html?|php|aspx?|jsp|pdf)(\b|$)|^[\w-]+_[\w-]+$|^https?:\/\//i;
const VAGUE_LINK_RE = /^(click here|here|more|read more|learn more|more info|more information|details|link|this|go|continue|click)[.!…]*$/i;
const GENERIC_ALT_RE = /^(image|graphic|picture|photo|spacer|img|icon|logo|banner|bullet|pic|blank|untitled)$/i;
const END_RE = /^(no next|no previous|no more|not found|no (heading|landmark|link|button|form field|graphic|control)s?\b)|^\w+ not found$/i;
// VoiceOver re-announces the last item with a prefix when it cannot move: "Last heading heading level 1 …".
const LAST_RE = /^last (heading|link|image|form element|control|button|landmark|table|item|graphic)\s+/i;

const PEEL_WORDS = [
  ...ROLE_WORDS.map(([w]) => w),
  'pop up button',
  'web content',
  'collapsed',
  'expanded',
  'visited',
  'dimmed',
  'selected',
  'required',
  'invalid data',
  'clickable',
  'has popup',
  'group',
].sort((a, b) => b.length - a.length);
/** Split "Title collapsed pop up button" into ["Title", "collapsed", "pop up button"]. */
function peel(tk, expect) {
  const ok = (w) => !AMBIGUOUS.has(w) || expect.includes((ROLE_WORDS.find((x) => x[0] === w) || [])[1]) || w === 'link' || w === 'image';
  const words = PEEL_WORDS.filter(ok).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const tailRe = new RegExp(`^(.*?)\\s+(${words.join('|')}|heading level \\d|\\d+ items?)$`, 'i');
  const headRe = new RegExp(`^(heading level \\d|${words.join('|')})\\s+(.+)$`, 'i');
  const head = [];
  const tail = [];
  let rest = tk.trim();
  for (let i = 0; i < 6; i++) {
    const m = tailRe.exec(rest);
    if (!m || !m[1].trim()) break;
    tail.unshift(m[2]);
    rest = m[1].trim();
  }
  const h = /^(heading level \d|heading)\s+(.+)$/i.exec(rest) || (tail.length ? null : headRe.exec(rest));
  if (h) {
    head.push(h[1]);
    rest = h[2].trim();
  }
  if (!head.length && !tail.length) {
    const solo = new RegExp(`^(${words.join('|')})$`, 'i').exec(rest);
    if (solo) return [rest];
  }
  return [...head, ...(rest ? [rest] : []), ...tail];
}

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
  let src = String(phrase ?? '');
  for (const r of NOISE_RE) src = src.replace(r, '');
  const last = LAST_RE.test(src.trim());
  if (last) src = src.trim().replace(LAST_RE, '');
  const text = clean(src);
  const out = {
    raw: String(phrase ?? ''),
    role: null,
    name: '',
    states: [],
    level: null,
    end: END_RE.test(text),
    unlabeled: false,
    guess: null,
    last,
    key: text.toLowerCase(),
  };
  if (!text || out.end) return out;
  let tokens = src
    .trim()
    .split(/\s*,\s*|\s{2,}|\s+\|\s+|\n/)
    .map(clean)
    .filter(Boolean);
  // VoiceOver speaks without separators ("nav_home.gif link image", "heading level 1 Title 3 items"):
  // peel role and state words off both ends of a single-token phrase, repeatedly.
  const expanded = [];
  const hasRoleToken = tokens.some((tk) => roleOf(tk, expect));
  for (const tk of tokens) {
    if (hasRoleToken || roleOf(tk, expect) || STATE_RE.some((r) => r.test(tk.toLowerCase()))) expanded.push(tk);
    else expanded.push(...peel(tk, expect));
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
      if (j === i) return;
      // Other role words spoken in lower case are nested or containing roles ("link, graphic, logo.gif",
      // "Story, link, heading, level 2"), not part of the name. Capitalised ones ("Search") stay as names.
      if (tokens[j] === tokens[j].toLowerCase() || (r2.role === r.role && r2.word === r.word)) used.add(j);
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
  // NVDA: "<guess>, Unlabeled graphic" = an image with no text alternative; the guess comes from the file name.
  const ui = tokens.findIndex((tk) => /^unlabell?ed graphic$/i.test(tk));
  if (ui >= 0) {
    out.unlabeled = true;
    used.add(ui);
    if (ui > 0 && !used.has(ui - 1)) {
      out.guess = clean(tokens[ui - 1]);
      used.add(ui - 1);
    }
  }
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
  const parsed = phrases.map((p) => parsePhrase(p, expect)).filter((p) => p.key);
  if (!parsed.length) return parsePhrase('', expect);
  return [...parsed].reverse().find((p) => expect.includes(p.role)) || parsed[parsed.length - 1];
}

/** Trim the trailing run of identical announcements a pass ends on when the screen reader stops moving. */
function dedupeTail(items, endReason) {
  if (endReason !== 'repeat' || items.length < 2) return items;
  let k = items.length - 1;
  while (k > 0 && items[k - 1].a.key === items[k].a.key) k--;
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
    const seen = new Set();
    const items = (p.steps || [])
      .map((s, i) => ({ s, i: i + 1, a: stepAnnouncement(s, pass) }))
      .filter((x) => !x.a.end && x.a.key)
      // a "Last …" re-announcement of an item already heard is VoiceOver failing to move, not a new item
      .filter((x) => {
        const dup = x.a.last && seen.has(x.a.key);
        seen.add(x.a.key);
        return !dup;
      });
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
  // An "Unlabeled graphic" whose spoken guess equals a real alt on the page is a screen-reader quirk, not a missing alt.
  const squash = (x) =>
    String(x || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  const realAlts = new Set((t.images || []).map((i) => squash(i.alt)).filter(Boolean));
  const quirk = (a) => a.unlabeled && a.guess && realAlts.has(squash(a.guess));
  // Links
  const lk = itemsOf('links');
  if (lk) {
    const links = lk.filter((x) => x.a.role === 'link');
    stats.links = links.length;
    for (const l of links) {
      if (!l.a.name && l.a.unlabeled && !quirk(l.a))
        add(
          'LINK-NO-NAME',
          'links',
          l.i,
          `link has no name; ${sr} said "Unlabeled graphic" and guessed "${l.a.guess || ''}" from the image file: "${short(l.a.raw)}"`,
          {
            spoken: l.a.raw,
          },
        );
      else if (!l.a.name && !l.a.unlabeled)
        add('LINK-NO-NAME', 'links', l.i, `link announced with no name: "${short(l.a.raw)}"`, { spoken: l.a.raw });
      else if (FILENAME_RE.test(l.a.name))
        add('LINK-FILENAME', 'links', l.i, `link announced as a file name or URL: "${short(l.a.raw)}"`, { spoken: l.a.raw });
      else if (VAGUE_LINK_RE.test(l.a.name))
        add('VAGUE-LINK', 'links', l.i, `link text gives no purpose out of context: "${short(l.a.raw)}"`, { spoken: l.a.raw });
    }
  }
  // Same link text more than once: if the targets differ, a links list cannot tell them apart (2.4.4).
  if (lk) {
    const byName = new Map();
    for (const l of lk.filter((x) => x.a.role === 'link' && x.a.name)) {
      const k = l.a.name.toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(l);
    }
    // Targets: from the page's link list (DOM, recorded by the driver) and from Tab stops. Unknown targets: no flag.
    const hrefs = new Map();
    const addHref = (name, href) => {
      if (!name || !href || /^javascript:/i.test(href)) return;
      const k = name.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!hrefs.has(k)) hrefs.set(k, new Set());
      hrefs.get(k).add(href.replace(/#.*$/, ''));
    };
    for (const l of t.links || []) addHref(l.name, l.href);
    for (const x of tabSteps) addHref(x.a.name, x.s.dom?.href);
    for (const [k, ls] of byName) {
      if (ls.length < 2) continue;
      const h = hrefs.get(k);
      if (!h || h.size < 2) continue; // same target every time, or unknown: not flagged
      add(
        'DUPLICATE-LINK-NAMES',
        'links',
        ls[0].i,
        `${ls.length} links all announced as "${ls[0].a.name}" go to ${h.size} different pages: ${[...h].slice(0, 3).join(', ')}`,
        {
          spoken: ls[0].a.raw,
        },
      );
    }
  }
  // Graphics
  const gs = itemsOf('graphics');
  if (gs) {
    const imgs = gs.filter((x) => x.a.role === 'image');
    stats.graphics = imgs.length;
    for (const g of imgs) {
      if (quirk(g.a)) continue;
      if (g.a.unlabeled)
        add(
          'IMG-NO-ALT',
          'graphics',
          g.i,
          `${sr} said "Unlabeled graphic"${g.a.guess ? ` and guessed "${g.a.guess}" from the file name` : ''}: "${short(g.a.raw)}"`,
          { spoken: g.a.raw },
        );
      else if (!g.a.name)
        add('IMG-NO-ALT', 'graphics', g.i, `graphic announced with no text alternative: "${short(g.a.raw)}"`, { spoken: g.a.raw });
      else if (FILENAME_RE.test(g.a.name))
        add('IMG-FILENAME', 'graphics', g.i, `graphic announced by file name: "${short(g.a.raw)}"`, { spoken: g.a.raw });
      else if (GENERIC_ALT_RE.test(g.a.name))
        add('IMG-VAGUE-ALT', 'graphics', g.i, `graphic announced with a generic name: "${short(g.a.raw)}"`, { spoken: g.a.raw });
    }
  }
  // Tab focus problems. Focus on the page body for a run of Tab presses, then back on an element not reached
  // before, means a script removed focus and skipped controls (F55). A run that never comes back is the end of
  // the tab order (focus moved to the browser), which is normal and not flagged.
  const seenSel = new Set();
  let run = 0;
  for (let k = 0; k < tabSteps.length; k++) {
    const x = tabSteps[k];
    const d = x.s.dom || {};
    const body = d.none || d.tag === 'body';
    if (body) {
      let j = k;
      while (j < tabSteps.length && (tabSteps[j].s.dom?.none || tabSteps[j].s.dom?.tag === 'body')) j++;
      const back = tabSteps[j];
      const prevEl = tabSteps[k - 1]?.s.dom;
      if (back && back.s.dom?.selector && !seenSel.has(back.s.dom.selector))
        add(
          'FOCUS-REMOVED',
          'tab',
          x.i,
          `Tab ${x.i}-${j}: after ${prevEl?.selector || 'the previous control'} keyboard focus fell to the page body for ${j - k} press(es), then resumed at ${back.s.dom.selector}; controls in between were skipped. ${sr} said "${short(x.a.raw) || '(nothing)'}"`,
          { target: prevEl?.selector || null, spoken: x.a.raw },
        );
      k = j - 1;
      continue;
    }
    if (d.selector) seenSel.add(d.selector);
    if (d.tag && !x.a.name && !d.name && x.a.role !== 'image' && !x.a.unlabeled)
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
