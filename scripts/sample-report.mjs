// Regenerate docs/sample-report (all formats incl. report.pdf) from a LIVE run against the local fictional checkout fixture.
// No network: serves test/fixtures on 127.0.0.1, runs the ada-audit CLI (read-only), then copies only the
// screenshots the report references into docs/sample-report/screenshots/ and makes every path repo-relative.
// `npm run sample-report` (needs `npx playwright install chromium`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDocument } from '../src/findings/document.mjs';
import { writeReports, writePdf } from '../src/report/index.mjs';
import { validateDocument } from '../src/findings/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4177);
const base = `http://127.0.0.1:${PORT}`;
const page = `${base}/checkout-bad.html`;
const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-sample-'));
const out = path.join(root, 'docs/sample-report');

const server = spawn(process.execPath, [path.join(root, 'test/serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  server.stdout.once('data', res);
  server.once('exit', (c) => rej(new Error(`fixture server exited ${c} (port ${PORT} busy? set PORT=)`)));
});
try {
  const journeys = [{ name: 'Checkout', goal: 'checkout', urls: [page] }];
  const r = spawnSync(
    process.execPath,
    [
      path.join(root, 'bin/ada-audit.mjs'),
      page,
      '--journey',
      `Checkout=${page}`,
      '--journeys',
      '--goal',
      'checkout',
      '--personas',
      'keyboard,sr,zoom',
      '--format',
      'json',
      '--platform',
      'shopify',
      '-o',
      raw,
      '-q',
    ],
    { stdio: 'inherit', env: { ...process.env, SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH || '1794765600' } },
  );
  if (r.status !== 0) throw new Error(`ada-audit exited ${r.status}`);
  const run = JSON.parse(fs.readFileSync(path.join(raw, 'run.json'), 'utf8'));
  const doc = buildDocument(raw, {
    run: {
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      pages: run.pages,
      tools: run.tools,
      widths: run.widths,
      versions: run.versions,
      readOnly: true,
      platform: 'shopify',
    },
    journeys,
  });
  doc.run.versions.node = null; // machine-specific; keep the committed sample stable

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'screenshots'), { recursive: true });
  const copied = new Map();
  const keep = (abs) => {
    if (!copied.has(abs)) {
      const name = path.relative(raw, abs).split(path.sep).join('__');
      fs.copyFileSync(abs, path.join(out, 'screenshots', name));
      copied.set(abs, path.join(out, 'screenshots', name));
    }
    return copied.get(abs);
  };
  for (const f of doc.findings)
    for (const l of f.locations) {
      l.screenshots = l.screenshots.filter((s) => fs.existsSync(s)).map(keep);
      for (const ev of l.evidence) if (ev.file) ev.file = path.relative(raw, ev.file).split(path.sep).join('/');
    }
  writeReports(doc, out, { formats: ['json', 'md', 'html', 'sarif', 'csv'], platform: 'shopify' });
  await writePdf(doc, out, { platform: 'shopify' }); // the client-ready PDF report
  // findings.json: screenshot paths relative to the sample folder, not this machine.
  const j = path.join(out, 'findings.json');
  const d = JSON.parse(fs.readFileSync(j, 'utf8'));
  for (const f of d.findings)
    for (const l of f.locations) l.screenshots = l.screenshots.map((s) => path.relative(out, s).split(path.sep).join('/'));
  const errs = validateDocument(d);
  if (errs.length) throw new Error('sample findings.json invalid:\n' + errs.join('\n'));
  fs.writeFileSync(j, JSON.stringify(d, null, 2) + '\n');
  for (const f of ['findings.sarif', 'findings.csv', 'report.md', 'report.html']) {
    const p = path.join(out, f);
    fs.writeFileSync(
      p,
      fs
        .readFileSync(p, 'utf8')
        .split(out + path.sep)
        .join('')
        .split(raw + path.sep)
        .join(''),
    );
  }
  console.log(`docs/sample-report: ${d.findings.length} findings, ${copied.size} screenshots`);
} finally {
  server.kill();
  fs.rmSync(raw, { recursive: true, force: true });
}
