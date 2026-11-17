// Write every requested report format next to the raw outputs.
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from './markdown.mjs';
import { renderHtml } from './html.mjs';
import { renderSarif } from './sarif.mjs';
import { renderCsv } from './csv.mjs';
import { writePdf, PAPER } from './pdf.mjs';

export const FORMATS = {
  json: 'findings.json',
  md: 'report.md',
  html: 'report.html',
  sarif: 'findings.sarif',
  csv: 'findings.csv',
  pdf: 'report.pdf',
};
export { writePdf, PAPER };

// Synchronous text formats. "pdf" needs a browser: use writeAllReports (async) for it.
export function writeReports(doc, outDir, { formats = ['json', 'md', 'html'], platform = null } = {}) {
  const written = {};
  for (const fmt of formats) {
    if (fmt === 'pdf') throw new Error('writeReports cannot render "pdf"; use writeAllReports or writePdf');
    const file = path.join(outDir, FORMATS[fmt]);
    const body =
      fmt === 'json'
        ? JSON.stringify(doc, null, 2) + '\n'
        : fmt === 'md'
          ? renderMarkdown(doc, { outDir, platform })
          : fmt === 'html'
            ? renderHtml(doc, { outDir, platform })
            : fmt === 'sarif'
              ? renderSarif(doc)
              : renderCsv(doc);
    fs.writeFileSync(file, body);
    written[fmt] = file;
  }
  return written;
}

// Every format, including the PDF report (headless Chromium).
export async function writeAllReports(doc, outDir, { formats = ['json', 'md', 'html', 'pdf'], platform = null, paper = 'a4' } = {}) {
  const written = writeReports(doc, outDir, { formats: formats.filter((f) => f !== 'pdf'), platform });
  if (formats.includes('pdf')) written.pdf = await writePdf(doc, outDir, { platform, paper });
  return written;
}
