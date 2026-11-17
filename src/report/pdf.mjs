// PDF report: the HTML report in print mode (cover, top issues with screenshots, fix plan, findings table,
// per-finding fix/effort/check, limits) rendered by headless Chromium with page.pdf. Tagged PDF (structure
// tree from the HTML: lang, title, headings, tables, image alt) and an outline from the headings, as far as
// Chromium supports them. Read-only: the page is a local file; no network requests are allowed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { renderHtml } from './html.mjs';

export const PAPER = { a4: 'A4', letter: 'Letter' };

export async function writePdf(doc, outDir, { platform = null, paper = 'a4', file = 'report.pdf' } = {}) {
  const format = PAPER[String(paper).toLowerCase()];
  if (!format) throw new Error(`unknown paper "${paper}" (use a4 or letter)`);
  const html = renderHtml(doc, { outDir, platform, pdf: true });
  const tmp = path.join(outDir, `.report-print-${process.pid}.html`);
  const target = path.join(outDir, file);
  fs.writeFileSync(tmp, html);
  const site = doc.run.pages[0] ? new URL(doc.run.pages[0]).host : 'site';
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    // Only local files (the report and its screenshots) may load.
    await context.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const foot = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    await page.pdf({
      path: target,
      format,
      printBackground: true,
      margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font:8px system-ui,sans-serif;color:#4a4a4a;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>Accessibility audit report · ${foot(site)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      tagged: true,
      outline: true,
    });
  } finally {
    await browser.close();
    fs.rmSync(tmp, { force: true });
  }
  return target;
}
