// Adapters: read each tool's raw output (the v4 formats, unchanged) and turn it into raw candidates.
// A raw candidate is tool-specific; model.mjs normalises, dedupes and scores them into findings.
// Pure functions over files: they work on any output directory, including runs made with the old script names.
import fs from 'node:fs';
import path from 'node:path';
import { RULES, rulesFor, ruleRegex } from './rules.mjs';
import { scFromAxeTag, SC } from './wcag.mjs';
import { analyzeTranscript } from '../sr/analyze.mjs';

/** @typedef {{tool:string, ruleId:string, url:string|null, width:number|null, target:string|null, detail:string, toolConfidence?:string, file:string, line?:number, screenshot?:string|null, persona?:string, outcome?:string, journeyGoal?:string, axe?:object, helpUrl?:string}} RawCandidate */

const URL_RE = /https?:\/\/[^\s|"'<>]+/;
function headerInfo(lines) {
  const info = { url: null, width: null, extra: {} };
  for (const l of lines.slice(0, 4)) {
    if (!l.startsWith('#')) continue;
    const u = l.match(URL_RE);
    if (u && !info.url) info.url = u[0];
    const w = l.match(/width=(\d+)|(?:mobile|desktop) (\d+)/);
    if (w && !info.width) info.width = Number(w[1] || w[2]);
    const g = l.match(/goal=(\w+)/);
    if (g) info.extra.goal = g[1];
  }
  return info;
}
const confOf = (s) => (/\b(high|medium|low)\)/.exec(s) || [])[1];
const listFiles = (dir, re) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => re.test(f))
        .sort()
        .map((f) => path.join(dir, f))
    : [];

/** Generic line scanner: every catalog code of `tool` found in a line becomes a candidate. */
function scanLines(tool, file, { skip = () => false, target = () => null, section = () => true } = {}) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const h = headerInfo(lines);
  const rules = rulesFor(tool);
  const out = [];
  let sec = '';
  lines.forEach((line, i) => {
    if (/^##\s/.test(line)) {
      sec = line.replace(/^##\s*/, '');
      return;
    }
    if (line.startsWith('#') || !line.trim() || skip(line, sec) || !section(sec, line)) return;
    const taken = [];
    for (const r of rules) {
      const m = ruleRegex(r).exec(line);
      if (!m) continue;
      // a shorter code inside a longer one already matched (e.g. PASTE-BLOCKED vs PASTE-BLOCKED(bp)) is skipped
      if (taken.some(([a, b]) => m.index >= a && m.index < b)) continue;
      taken.push([m.index, m.index + Math.max(m[0].length, r.code.length)]);
      out.push({
        tool,
        ruleId: r.id,
        url: h.url,
        width: h.width,
        target: target(line, sec, r) ?? null,
        detail: line.trim().slice(0, 400),
        toolConfidence: confOf(line),
        file,
        line: i + 1,
        journeyGoal: h.extra.goal,
      });
    }
  });
  return { header: h, candidates: out, lines };
}

const tabCols = (line) => {
  const c = line.split('\t');
  return c.length >= 3 ? `${c[1]} ${c[2]}`.trim() : null;
};

export const ADAPTERS = {
  axe(dir) {
    const out = [];
    for (const file of listFiles(path.join(dir, 'axe'), /\.json$/)) {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const shot = file.replace(/\.json$/, '.png');
      for (const v of d.violations || []) {
        const scs = [...new Set(v.tags.map(scFromAxeTag).filter(Boolean))].filter((s) => SC[s]);
        const aaa = v.tags.includes('wcag2aaa') || scs.some((s) => SC[s]?.[1] === 'AAA');
        const kind = scs.length && !aaa ? 'failure' : aaa ? 'aaa' : 'best-practice';
        for (const n of v.nodes || []) {
          out.push({
            tool: 'axe',
            ruleId: `axe/${v.id}`,
            url: d.url,
            width: d.width,
            target: (n.target || []).flat().join(' '),
            detail: `${v.help}${n.failureSummary ? ': ' + n.failureSummary.split('\n').slice(0, 2).join(' ').trim() : ''}`.slice(0, 400),
            file,
            screenshot: fs.existsSync(shot) ? shot : null,
            axe: {
              id: v.id,
              impact: n.impact || v.impact,
              sc: scs,
              kind,
              html: (n.html || '').slice(0, 300),
              help: v.help,
              version: d.axe,
            },
            helpUrl: v.helpUrl,
          });
        }
      }
    }
    return out;
  },
  'bypass-order'(dir) {
    const out = [];
    for (const file of listFiles(path.join(dir, 'bypass-order'), /\.json$/)) {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rules = rulesFor('bypass-order');
      for (const fl of d.flags || []) {
        const r = rules.find((x) => ruleRegex(x).test(fl.split('\t')[0]));
        if (!r) continue;
        const cols = fl.split('\t');
        out.push({
          tool: 'bypass-order',
          ruleId: r.id,
          url: d.url,
          width: d.width,
          target: /^(READING|LAYOUT|FOCUS-ORDER)/.test(r.code) ? cols[1] || null : null,
          detail: fl.slice(0, 400),
          toolConfidence: confOf(cols[0]),
          file,
        });
      }
    }
    return out;
  },
  journeys(dir) {
    const out = [];
    const jdir = path.join(dir, 'journeys');
    for (const file of listFiles(jdir, /\.txt$/)) {
      const h = headerInfo(fs.readFileSync(file, 'utf8').split(/\r?\n/));
      const json = path.join(jdir, path.basename(file, '.txt'), 'journeys.json');
      if (!fs.existsSync(json)) continue;
      const rules = rulesFor('journeys');
      for (const p of JSON.parse(fs.readFileSync(json, 'utf8'))) {
        for (const is of p.issues || []) {
          const r = rules.find((x) => x.code.replace(/\?$/, '') === String(is.code).replace(/\?$/, ''));
          if (!r) continue;
          out.push({
            tool: 'journeys',
            ruleId: r.id,
            url: h.url || p.pages?.[0] || null,
            width: p.persona === 'zoom' ? 320 : p.persona === 'tremor' ? 390 : null,
            target: (/(?:^|\s)((?:div|a|button|nav|section|aside|span|img|input)[#.][\w-]+)/.exec(is.detail || '') || [])[1] || null,
            detail: String(is.detail || '')
              .replace(/\s+/g, ' ')
              .slice(0, 400),
            toolConfidence: is.conf,
            file: json,
            screenshot: is.shot ? path.join(jdir, path.basename(file, '.txt'), is.shot) : null,
            persona: p.persona,
            outcome: p.outcome,
            journeyGoal: h.extra.goal,
          });
        }
      }
    }
    return out;
  },
  'tab-walk'(dir) {
    const out = [];
    for (const file of listFiles(path.join(dir, 'tab-walk'), /\.tsv$/)) {
      const r = scanLines('tab-walk', file, {
        target: (l) => tabCols(l),
        skip: (l) => /\t""\t.*\tTEXT \d/.test(l) && !/NO-RING|COVERED|OFFSCREEN|REPEAT/.test(l),
      });
      // TEXT contrast on an element with no text is meaningless: drop it
      // Element crop for the stop (tab-walk writes <tsv name>/<NN>.png for flagged stops).
      const crops = file.replace(/\.tsv$/, '');
      for (const c of r.candidates) {
        if (c.ruleId === 'tab-walk/text' && / ""$/.test(c.target || '')) continue;
        const n = /^(\d+)\t/.exec(c.detail);
        const png = n && path.join(crops, `${n[1].padStart(2, '0')}.png`);
        if (png && fs.existsSync(png)) c.screenshot = png;
        out.push(c);
      }
      if (r.lines.some((l) => /WRAPPED to first stop: walk complete|END-OF-TAB-ORDER/.test(l)))
        out.push({
          tool: 'tab-walk',
          ruleId: '_meta/walk-complete',
          url: r.header.url,
          width: r.header.width,
          target: null,
          detail: 'tab walk reached the end of the tab order',
          file,
        });
    }
    return out;
  },
  'focus-state'(dir) {
    return listFiles(path.join(dir, 'focus-state'), /\.tsv$/).flatMap(
      (f) => scanLines('focus-state', f, { target: (l) => l.split('\t')[0] }).candidates,
    );
  },
  'menu-modal'(dir) {
    return listFiles(path.join(dir, 'menu-modal'), /\.txt$/).flatMap((f) => {
      const r = scanLines('menu-modal', f);
      const trig = (fs.readFileSync(f, 'utf8').match(/trigger=(\S+)/) || [])[1] || null;
      return r.candidates.map((c) => ({ ...c, target: trig }));
    });
  },
  forms(dir) {
    return listFiles(path.join(dir, 'forms'), /\.txt$/).flatMap(
      (f) =>
        scanLines('forms', f, {
          skip: (l) => /^SUMMARY/.test(l),
          target: (l) => {
            const m = /^\s+(\w+)\[[\w-]+\] id=(\S*) name=(\S*)/.exec(l);
            return m
              ? `${m[1]}${m[2] ? '#' + m[2] : m[3] ? `[name=${m[3]}]` : ''}`
              : /FORM (\d+)/.exec(l)
                ? `form ${/FORM (\d+)/.exec(l)[1]}`
                : null;
          },
        }).candidates,
    );
  },
  inventory(dir) {
    return listFiles(path.join(dir, 'inventory'), /\.txt$/).flatMap(
      (f) =>
        scanLines('inventory', f, {
          target: (l, s, r) => (r.concept === 'page-language' || r.code === 'OVERLAY' ? null : l.split('\t')[1]?.slice(0, 120) || null),
          skip: (l) => /^alt review sheet|^ALL:/.test(l),
        }).candidates,
    );
  },
  reflow(dir) {
    return listFiles(path.join(dir, 'reflow'), /\.txt$/).flatMap((f) =>
      scanLines('reflow', f).candidates.map((c) => ({ ...c, width: 320 })),
    );
  },
  motion(dir) {
    return listFiles(path.join(dir, 'motion'), /\.txt$/).flatMap((f) => scanLines('motion', f).candidates);
  },
  'sr-transcript'(dir) {
    return listFiles(path.join(dir, 'sr-transcript'), /\.txt$/).flatMap(
      (f) =>
        scanLines('sr-transcript', f, {
          // Flags section has every linear-read flag; from the Tab pass take only what the Flags section can't show.
          section: (sec, l) => /^Flags/.test(sec) || (/^Tab pass/.test(sec) && /REPEAT\(trap|FOCUS-LOST/.test(l)),
          // identical empty names in a row are the NO-NAME problem, not a trap
          skip: (l, sec) => /^Tab pass/.test(sec) && /\t""\t/.test(l) && /REPEAT\(trap/.test(l),
          target: (l, sec) => {
            const c = l.split('\t');
            return /^Tab pass/.test(sec) ? `${c[1]} ${c[2]}` : c[2] && c[0] !== '-' ? c[2].slice(0, 120) : null;
          },
        }).candidates,
    );
  },
  // Real screen readers: re-analyse every recorded transcript (so analysis fixes apply to old runs too).
  'real-sr'(dir) {
    const out = [];
    const rules = rulesFor('real-sr');
    for (const file of listFiles(path.join(dir, 'real-sr'), /\.json$/)) {
      const t = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (t.schema !== 'ada-real-sr/1') continue;
      const { flags, errors } = analyzeTranscript(t);
      const sr = `${t.screenReader?.name || 'screen reader'}${t.screenReader?.version ? ' ' + t.screenReader.version : ''} + ${t.browser?.name || '?'}${t.browser?.version ? ' ' + t.browser.version : ''}`;
      for (const e of errors)
        out.push({ tool: 'real-sr', ruleId: '_meta/adapter-error', url: t.url, width: null, target: null, detail: e, file });
      for (const f of flags) {
        const r = rules.find((x) => x.code === f.code);
        if (!r) continue;
        out.push({
          tool: 'real-sr',
          ruleId: r.id,
          url: t.url,
          width: null,
          target: f.target || null,
          detail: f.detail,
          file: file.replace(/\.json$/, '.txt'),
          line: null,
          toolConfidence: f.toolConfidence,
          sr,
          method: 'real-screen-reader',
        });
      }
    }
    return out;
  },
  'context-change'(dir) {
    const tgt = (l) => {
      const t = l.split('\t')[1] || '';
      const sel = /^([a-z][\w-]*[#.][\w-]+)/.exec(t);
      if (sel) return sel[1];
      const m = /^(select|text field) \d* ?"([^"]*)"/.exec(t);
      return m ? `${m[1]} "${m[2]}"` : t.slice(0, 80) || null;
    };
    return listFiles(path.join(dir, 'context-change'), /\.txt$/).flatMap((f) => scanLines('context-change', f, { target: tgt }).candidates);
  },
  'sample-compare'(dir) {
    return listFiles(path.join(dir, 'sample-compare'), /\.txt$/).flatMap((f) =>
      scanLines('sample-compare', f, { target: () => null }).candidates.map((c) => ({ ...c, url: (c.detail.match(URL_RE) || [null])[0] })),
    );
  },
};

/** Run every adapter whose raw folder exists in `dir`. */
export function collectRaw(dir) {
  const all = [];
  for (const [tool, fn] of Object.entries(ADAPTERS)) {
    const sub = path.join(dir, tool);
    if (!fs.existsSync(sub)) continue;
    try {
      all.push(...fn(dir));
    } catch (e) {
      all.push({
        tool,
        ruleId: '_meta/adapter-error',
        url: null,
        width: null,
        target: null,
        detail: `adapter ${tool} failed: ${e.message}`,
        file: sub,
      });
    }
  }
  return all;
}
export { RULES };
