import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocument } from '../../src/findings/document.mjs';
import { renderMarkdown } from '../../src/report/markdown.mjs';
import { renderHtml } from '../../src/report/html.mjs';
import { renderSarif } from '../../src/report/sarif.mjs';
import { renderCsv, CSV_COLUMNS } from '../../src/report/csv.mjs';
import { writeReports } from '../../src/report/index.mjs';
import { conformanceStatement } from '../../src/report/guidance.mjs';
const DATA = fileURLToPath(new URL('../data/raw-checkout', import.meta.url));
const run = {
  startedAt: '2026-11-15T12:00:00.000Z',
  finishedAt: '2026-11-15T12:01:00.000Z',
  widths: [390],
  versions: { tool: '4.2.0', playwright: '1.65.1', axe: '4.14.0', vsr: '0.33.0' },
};
const doc = buildDocument(DATA, { run });

test('markdown leads with the executive summary, then plan, table, cards, manual checks, scope', () => {
  const md = renderMarkdown(doc, { outDir: DATA, platform: 'shopify' });
  const idx = [
    '## 1. Executive summary',
    '## 2. Fix plan',
    '## 3. Findings at a glance',
    '## 4. Findings and how to fix them',
    '## 7. Not tested',
    '## 8. Scope, methods and statement',
  ].map((h) => md.indexOf(h));
  idx.forEach((i) => assert.ok(i >= 0));
  assert.deepEqual(
    [...idx].sort((a, b) => a - b),
    idx,
  );
  assert.match(md, /### Quick wins/);
  for (const f of doc.findings.filter((x) => x.kind === 'failure')) assert.ok(md.includes(`### ${f.id} `), f.id);
  assert.match(md, /\*\*How to verify:\*\*/);
  assert.match(md, /Shopify: /);
  assert.doesNotMatch(md, /WordPress: Form plugin field settings/);
});
test('every failure card has the full resolution block', () => {
  const md = renderMarkdown(doc, { outDir: DATA });
  for (const block of md
    .split(/^### F-/m)
    .slice(1)
    .filter((b) => doc.findings.find((f) => f.id === 'F-' + b.slice(0, 3))?.kind === 'failure'))
    for (const field of ["What's wrong", 'Who it hurts', 'WCAG', 'How found', 'Where', 'How to fix', 'How to verify'])
      assert.ok(block.includes(`**${field}:**`), `F-${block.slice(0, 3)} ${field}`);
});
test('html report is accessible by construction', () => {
  const html = renderHtml(doc, { outDir: DATA });
  assert.match(html, /^<!doctype html><html lang="en">/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /<a class="skip" href="#main">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<nav aria-label="Contents">/);
  const tables = html.match(/<table>[\s\S]*?<\/table>/g) || [];
  assert.ok(tables.length >= 2);
  for (const t of tables) {
    assert.match(t, /<caption>/);
    assert.doesNotMatch(t.replace(/<th scope="(col|row)">/g, ''), /<th[\s>]/);
  }
  for (const f of doc.findings.filter((x) => x.kind === 'failure')) assert.ok(html.includes(`id="${f.id}"`));
  assert.doesNotMatch(html, /<script/i);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
});
test('sarif 2.1.0: one result per location, stable fingerprints', () => {
  const s = JSON.parse(renderSarif(doc));
  assert.equal(s.version, '2.1.0');
  assert.equal(
    s.runs[0].results.length,
    doc.findings.reduce((a, f) => a + f.locations.length, 0),
  );
  assert.ok(s.runs[0].results.every((r) => /^[0-9a-f]{16}$/.test(r.partialFingerprints['adaAudit/v1'])));
});
test('csv: header + one row per location, RFC 4180 quoting', () => {
  const csv = renderCsv(doc).trimEnd().split('\r\n');
  assert.equal(csv[0], CSV_COLUMNS.join(','));
  assert.equal(
    csv.length - 1,
    doc.findings.reduce((a, f) => a + f.locations.length, 0),
  );
});
test('conformance wording never claims compliance', () => {
  assert.equal(doc.conformance.claim, false);
  assert.match(doc.conformance.statement, /candidate WCAG 2\.2 Level A\/AA failures/);
  assert.match(doc.conformance.statement, /do not currently meet WCAG 2\.2 AA/);
  const clean = conformanceStatement({
    summary: { failures: 0, failuresConfirmedByRules: 0 },
    run: { ...run, pages: ['https://x.test/'], tools: ['axe'] },
  });
  assert.match(clean, /^No WCAG 2\.2 Level A\/AA failures were found on the 1 page listed in Scope/);
  assert.match(clean, /This is not a conformance claim/);
});
test('writeReports writes every format; output is deterministic', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-rep-'));
  const w1 = writeReports(doc, dir, { formats: ['json', 'md', 'html', 'sarif', 'csv'] });
  const first = Object.values(w1).map((f) => fs.readFileSync(f, 'utf8'));
  writeReports(buildDocument(DATA, { run }), dir, { formats: ['json', 'md', 'html', 'sarif', 'csv'] });
  assert.deepEqual(
    Object.values(w1).map((f) => fs.readFileSync(f, 'utf8')),
    first,
  );
  fs.rmSync(dir, { recursive: true });
});
test('manual checklist puts server-side form testing first when forms were checked', () => {
  assert.equal(doc.manualChecklist[0].priority, true);
  assert.match(doc.manualChecklist[0].check, /staging|test entry/);
});

test('keyScreenshot prefers element crops, then the narrowest width, and writes alt text', async () => {
  const { keyScreenshot } = await import('../../src/report/guidance.mjs');
  const f = {
    id: 'F-009',
    title: 'No visible focus indicator',
    locations: [
      {
        url: 'http://x.test/a',
        target: 'a "Home"',
        widths: [390, 1440],
        screenshots: ['o/axe/x_390.png', 'o/tab-walk/x_1440/01.png', 'o/tab-walk/x_390/01.png'],
      },
    ],
  };
  const s = keyScreenshot(f);
  assert.equal(s.file, 'o/tab-walk/x_390/01.png');
  assert.match(s.alt, /^Cropped screenshot of the focused control on \/a at 390 px wide, element a "Home"/);
  assert.equal(keyScreenshot({ ...f, locations: [{ ...f.locations[0], screenshots: [] }] }), null);
});

test('pdf-mode HTML: cover with date, scope, methods and limits; eager images; open details; one h1', () => {
  const h = renderHtml(doc, { outDir: DATA, pdf: true });
  assert.match(h, /<header class="cover">/);
  for (const k of ['Date', 'Standard', 'Scope', 'Result', 'Methods']) assert.match(h, new RegExp(`<dt>${k}</dt>`));
  assert.match(h, /Not legal advice\. Not a certification or conformance claim\./);
  assert.doesNotMatch(h, /loading="lazy"/);
  assert.doesNotMatch(h, /<details>/);
  assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
  assert.doesNotMatch(h, /<nav aria-label="Contents">/);
  assert.match(h, /<h2 id="table">3\. Findings at a glance<\/h2>/);
  assert.match(renderHtml(doc, { outDir: DATA }), /<nav aria-label="Contents">/, 'screen HTML unchanged');
});
test('writeReports refuses pdf (async writeAllReports renders it)', () => {
  assert.throws(() => writeReports(doc, os.tmpdir(), { formats: ['pdf'] }), /writeAllReports/);
});
