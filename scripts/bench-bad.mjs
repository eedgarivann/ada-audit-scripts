#!/usr/bin/env node
// Benchmark: compare a findings.json against W3C's BAD answer key (bench/bad-home-answer-key.json).
// Scores SC-level recall on the before home page per evidence method, and lists failures flagged on the
// after page (false-positive candidates). Usage: node scripts/bench-bad.mjs <findings.json> [--out bench.md] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from '../src/findings/rules.mjs';

const KEY = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../bench/bad-home-answer-key.json', import.meta.url)), 'utf8'));
const norm = (u) =>
  String(u || '')
    .replace(/[#?].*$/, '')
    .replace(/\/$/, '');

export function score(doc, key = KEY) {
  const before = norm(key.before);
  const after = norm(key.after);
  const fails = doc.findings.filter((f) => f.kind === 'failure');
  // Evidence lines carry the screen reader: "[NVDA]" / "[VoiceOver]".
  const evOn = (f, url, pred) => f.locations.some((l) => norm(l.url) === url && l.evidence.some(pred));
  // Credit only the criteria the method's own rules map to (a merged finding can carry criteria from other tools).
  const ruleSc = new Map(RULES.map((r) => [r.id, r.sc]));
  const scsOf = (f, url, pred) =>
    f.locations
      .filter((l) => norm(l.url) === url)
      .flatMap((l) => l.evidence.filter(pred))
      .flatMap((e) => (e.tool === 'axe' ? f.wcag.map((w) => w.sc) : ruleSc.get(e.rule) || []));
  const methods = {
    'real-screen-reader (any)': (e) => e.method === 'real-screen-reader' || e.tool === 'real-sr',
    'real NVDA': (e) => (e.method === 'real-screen-reader' || e.tool === 'real-sr') && /\[NVDA\]/.test(e.detail),
    'real VoiceOver': (e) => (e.method === 'real-screen-reader' || e.tool === 'real-sr') && /\[VoiceOver\]/.test(e.detail),
    'simulated screen reader': (e) => e.tool === 'sr-transcript',
    'automated rules (axe)': (e) => e.tool === 'axe',
    'scripted suite without real SR': (e) => e.tool !== 'real-sr',
    'everything (suite + real SR)': () => true,
  };
  const rows = {};
  for (const [name, pred] of Object.entries(methods)) {
    const hit = new Set();
    for (const f of fails) for (const sc of scsOf(f, before, pred)) if (key.fail.includes(sc)) hit.add(sc);
    const audible = key.screenReaderAudible.filter((s) => hit.has(s));
    const afterFlags = fails.filter((f) => evOn(f, after, pred)).map((f) => `${f.id} ${f.title} (${f.wcag.map((w) => w.sc).join(', ')})`);
    rows[name] = {
      hits: [...hit].sort(),
      recall: hit.size / key.fail.length,
      audibleRecall: audible.length / key.screenReaderAudible.length,
      misses: key.fail.filter((s) => !hit.has(s)),
      afterFlags,
      ran: fails.some((f) => f.locations.some((l) => l.evidence.some(pred))) || null,
    };
  }
  return rows;
}

export function renderBench(rows, doc, key = KEY) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const L = [
    `# Benchmark: ${key.name}`,
    '',
    `Answer key: ${key.source} (${key.fail.length} scorable A/AA criteria; ${key.note})`,
    `Screen-reader-audible subset (${key.screenReaderAudible.length}): ${key.screenReaderAudible.join(', ')}. ${key.screenReaderAudibleNote}`,
    `Run: ${doc.run.startedAt || '?'} → ${doc.run.finishedAt || '?'}; tools: ${doc.run.tools.join(', ')}; real screen readers: ${doc.run.versions?.realScreenReaders || 'none'}`,
    '',
    '| Evidence method | SC recall (of 18) | Audible recall (of 13) | Hits | After-page failures flagged (false-positive candidates) |',
    '|---|---|---|---|---|',
  ];
  for (const [name, r] of Object.entries(rows))
    L.push(
      `| ${name} | ${r.hits.length}/${key.fail.length} = ${pct(r.recall)} | ${pct(r.audibleRecall)} | ${r.hits.join(', ') || '—'} | ${r.afterFlags.length ? r.afterFlags.length + ': ' + r.afterFlags.join('; ') : '0'} |`,
    );
  L.push('', 'Misses per method:', '');
  for (const [name, r] of Object.entries(rows)) L.push(`- **${name}:** ${r.misses.join(', ') || 'none'}`);
  L.push(
    '',
    '_After-page flags are candidates to review, not automatically false positives: the 2012 key predates WCAG 2.1/2.2, and the after page has known 2.2 gaps (for example reflow and target size)._',
  );
  const runs = doc.realScreenReader || [];
  if (runs.length) {
    L.push(
      '',
      '## Real screen-reader runs',
      '',
      '| Screen reader + browser | Page | Passes (steps) | Ran fully | Transcript |',
      '|---|---|---|---|---|',
    );
    for (const r of runs)
      L.push(
        `| ${r.screenReader} ${r.screenReaderVersion || ''} + ${r.browser} ${r.browserVersion || ''} | ${r.url} | ${r.passes.map((p) => `${p.pass} ${p.error ? 'FAILED' : p.steps}`).join(', ')} | ${r.ok ? 'yes' : 'NO'} | ${r.transcript} |`,
      );
  }
  if (doc.errors?.length) L.push('', '## Errors (missing evidence, not clean results)', '', ...doc.errors.map((e) => `- ${e}`));
  return L.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file || !fs.existsSync(file)) {
    console.error('usage: node scripts/bench-bad.mjs <findings.json> [--out bench.md] [--json]');
    process.exit(2);
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = score(doc);
  const md = renderBench(rows, doc);
  const oi = args.indexOf('--out');
  if (oi >= 0) fs.writeFileSync(args[oi + 1], md);
  process.stdout.write(args.includes('--json') ? JSON.stringify(rows, null, 2) + '\n' : md);
}
