// Reproducible sample report from fictional fixtures only (no network, no private sites).
// `npm run sample-report` writes docs/sample-report/{findings.json,report.md,report.html,findings.sarif,findings.csv}.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocument } from '../src/findings/document.mjs';
import { writeReports } from '../src/report/index.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = path.join(root, 'test/data/raw-checkout');
const out = path.join(root, 'docs/sample-report');
const doc = buildDocument(raw, {
  run: {
    startedAt: '2026-11-15T12:00:00.000Z',
    finishedAt: '2026-11-15T12:01:00.000Z',
    widths: [390],
    tools: ['inventory', 'axe', 'tab-walk', 'forms', 'reflow', 'motion', 'sr-transcript', 'context-change', 'bypass-order'],
    versions: {
      tool: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
      playwright: '1.65.1',
      axe: '4.14.0',
      vsr: '0.33.0',
    },
    readOnly: true,
    platform: 'shopify',
  },
  journeys: [{ name: 'Checkout (assumed)', goal: 'checkout', urls: ['http://127.0.0.1:4176/checkout-bad.html'] }],
});
// Strip absolute test-data paths so the committed sample is portable.
for (const f of doc.findings)
  for (const l of f.locations) {
    for (const e of l.evidence) if (e.file) e.file = path.relative(root, e.file).split(path.sep).join('/');
    l.screenshots = [];
  }
fs.mkdirSync(out, { recursive: true });
const written = writeReports(doc, out, { formats: ['json', 'md', 'html', 'sarif', 'csv'], platform: 'shopify' });
console.log(
  Object.values(written)
    .map((f) => path.relative(root, f))
    .join('\n'),
);
