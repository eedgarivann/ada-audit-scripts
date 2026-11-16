// Assemble the versioned findings document (schema/findings.schema.json) from an output directory.
import fs from 'node:fs';
import path from 'node:path';
import { collectRaw } from './adapters.mjs';
import { buildFindings, summarize, SCHEMA_VERSION, normUrl } from './model.mjs';
import { conformanceStatement, manualChecklist } from '../report/guidance.mjs';
import { analyzeTranscript } from '../sr/analyze.mjs';

/** One summary row per real screen-reader transcript in <dir>/real-sr (written by `ada-audit sr`). */
export function realScreenReaderRuns(dir) {
  const d = path.join(dir, 'real-sr');
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      let t;
      try {
        t = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      } catch {
        return null;
      }
      if (t.schema !== 'ada-real-sr/1') return null;
      const { stats } = analyzeTranscript(t);
      return {
        screenReader: t.screenReader?.name || '?',
        screenReaderVersion: t.screenReader?.version || null,
        browser: t.browser?.name || '?',
        browserVersion: t.browser?.version || null,
        os: t.os ? `${t.os.platform} ${t.os.release}` : null,
        guidepup: t.guidepup || null,
        url: normUrl(t.url),
        journey: t.journey || null,
        transcript: path.join('real-sr', f.replace(/\.json$/, '.txt')),
        ok: !t.error && (t.passes || []).every((p) => !p.error),
        passes: (t.passes || []).map((p) => ({
          pass: p.pass,
          steps: (p.steps || []).length,
          endReason: p.endReason || null,
          error: p.error || null,
        })),
        stats,
      };
    })
    .filter(Boolean);
}

const PERSONA = {
  keyboard: 'Keyboard-only user',
  sr: 'Screen-reader user (simulated)',
  zoom: 'Low-vision user (320 px + 200% text)',
  tremor: 'Tremor/motor user',
  hurried: 'Hurried/cognitive user',
};

export function journeyOutcomes(dir) {
  const f = path.join(dir, 'journeys', 'summary.tsv');
  if (!fs.existsSync(f)) return [];
  const rows = fs
    .readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('url\t'));
  const seen = new Set();
  return rows
    .map((l) => {
      const [url, persona, outcome, steps, , simSeconds, , friction] = l.split('\t');
      return {
        url: normUrl(url),
        persona,
        personaLabel: PERSONA[persona] || persona,
        outcome,
        steps: Number(steps) || null,
        simSeconds: Number(simSeconds) || null,
        friction: friction && friction !== '-' ? friction : null,
      };
    })
    .filter((r) => {
      const k = `${r.url}|${r.persona}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => `${a.url}|${a.persona}`.localeCompare(`${b.url}|${b.persona}`));
}

/**
 * @param {string} dir output directory with raw tool folders
 * @param {{run?:object, journeys?:object[]}} opts
 */
export function buildDocument(dir, opts = {}) {
  const raws = collectRaw(dir);
  const run = { ...(opts.run || {}) };
  run.pages = run.pages?.length
    ? [...new Set(run.pages.map(normUrl))].sort()
    : [...new Set(raws.map((r) => normUrl(r.url)).filter(Boolean))].sort();
  run.tools = run.tools?.length ? run.tools : [...new Set(raws.map((r) => r.tool))].sort();
  run.versions = { ...(run.versions || {}) };
  const realSr = realScreenReaderRuns(dir);
  if (realSr.length) {
    // A real screen-reader run is its own method: list it as a tool and record its versions.
    if (!run.tools.includes('real-sr')) run.tools = [...run.tools, 'real-sr'];
    run.versions.guidepup = realSr.find((r) => r.guidepup)?.guidepup || null;
    run.versions.realScreenReaders = [
      ...new Set(realSr.map((r) => `${r.screenReader}${r.screenReaderVersion ? ' ' + r.screenReaderVersion : ''} + ${r.browser}`)),
    ].join('; ');
  }
  const { findings, suppressed, errors } = buildFindings(raws, { journeys: opts.journeys, versions: run.versions });
  const doc = {
    $schema: 'https://raw.githubusercontent.com/eedgarivann/ada-audit-scripts/main/schema/findings.schema.json',
    schemaVersion: SCHEMA_VERSION,
    generator: { name: 'ada-audit-scripts', version: run.versions.tool || null, url: 'https://github.com/eedgarivann/ada-audit-scripts' },
    run,
    criticalJourneys: (opts.journeys || []).map((j) => ({ name: j.name, goal: j.goal || null, urls: (j.urls || []).map(normUrl) })),
    journeysAssumed: !(opts.journeys && opts.journeys.length),
    summary: summarize(findings, suppressed),
    journeys: journeyOutcomes(dir),
    realScreenReader: realSr,
    findings,
    suppressed,
    errors: [...(opts.errors || []), ...errors],
  };
  doc.conformance = { target: 'WCAG 2.2 Level AA', statement: conformanceStatement(doc), claim: false };
  doc.manualChecklist = manualChecklist(doc);
  return doc;
}
