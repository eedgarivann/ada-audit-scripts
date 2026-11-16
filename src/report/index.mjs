// Write every requested report format next to the raw outputs.
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from './markdown.mjs';
import { renderHtml } from './html.mjs';
import { renderSarif } from './sarif.mjs';
import { renderCsv } from './csv.mjs';

export const FORMATS = { json: 'findings.json', md: 'report.md', html: 'report.html', sarif: 'findings.sarif', csv: 'findings.csv' };
export function writeReports(doc, outDir, { formats = ['json', 'md', 'html'], platform = null } = {}) {
  const written = {};
  for (const fmt of formats) {
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
