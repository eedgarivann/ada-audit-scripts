// The PDF report: real PDF, tagged (structure tree, /Lang, figures with alt), outlined, paper sizes, and the
// print HTML it is made from has no axe violations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { buildDocument } from '../../src/findings/document.mjs';
import { writePdf, writeAllReports } from '../../src/report/index.mjs';
import { renderHtml } from '../../src/report/html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(root, 'test/data/raw-checkout');
const run = { startedAt: '2026-11-15T12:00:00.000Z', finishedAt: '2026-11-15T12:01:00.000Z', widths: [390], versions: { tool: '4.4.0' } };
const tmpCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-pdf-'));
  fs.cpSync(DATA, dir, { recursive: true });
  return dir;
};

test('writePdf: tagged A4 PDF with title, language, outline; temp HTML removed', async () => {
  const dir = tmpCopy();
  const file = await writePdf(buildDocument(dir, { run }), dir);
  const pdf = fs.readFileSync(file);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const s = pdf.toString('latin1');
  assert.match(s, /\/StructTreeRoot/, 'tagged PDF');
  assert.match(s, /\/Lang \(en\)/, 'document language');
  assert.match(s, /\/Outlines/, 'bookmarks from headings');
  assert.match(s, /\/Title \(Accessibility audit report: /, 'document title');
  assert.match(s, /\/MediaBox \[0 0 595\.9\d* 842\.8\d*\]/, 'A4');
  assert.ok((s.match(/\/Type \/Page\b/g) || []).length >= 3, 'cover + summary + findings pages');
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.startsWith('.report-print-')),
    [],
  );
});

test('writeAllReports: letter paper, pdf next to the other formats', async () => {
  const dir = tmpCopy();
  const w = await writeAllReports(buildDocument(dir, { run }), dir, { formats: ['json', 'html', 'pdf'], paper: 'letter' });
  assert.deepEqual(Object.keys(w).sort(), ['html', 'json', 'pdf']);
  assert.match(fs.readFileSync(w.pdf).toString('latin1'), /\/MediaBox \[0 0 612 792\]/, 'US Letter');
  await assert.rejects(writePdf(buildDocument(dir, { run }), dir, { paper: 'a3' }), /unknown paper/);
});

test('sample report.pdf is committed and figures carry alt text', () => {
  const s = fs.readFileSync(path.join(root, 'docs/sample-report/report.pdf')).toString('latin1');
  assert.match(s, /\/StructTreeRoot/);
  assert.ok((s.match(/\/Figure/g) || []).length > 0, 'screenshots tagged as figures');
  assert.ok((s.match(/\/Alt/g) || []).length > 0, 'figures have alt text');
});

test('print HTML behind the PDF has no axe violations', async () => {
  const dir = tmpCopy();
  const f = path.join(dir, 'print.html');
  fs.writeFileSync(f, renderHtml(buildDocument(dir, { run }), { outDir: dir, pdf: true }));
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(pathToFileURL(f).href);
    await page.emulateMedia({ media: 'print' });
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(
      r.violations.map((v) => `${v.id}: ${v.nodes.length}`),
      [],
    );
  } finally {
    await browser.close();
  }
});
