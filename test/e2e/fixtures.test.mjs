// Offline end-to-end suite (node:test). Same 15 tool runs and 32 checks as test/run-fixtures.sh (v4.1.0),
// but run in parallel on one shared browser via the ada-audit runner; then the unified pipeline is checked
// on the checkout fixtures (findings, dedupe, plan, reports). Env: CONCURRENCY, PORT, OUT, SERIAL=1 (no sharing, 1 job).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { startBrowser, pool, runJob, defaultConcurrency } from '../../src/core/runner.mjs';
import { main } from '../../src/cli/ada-audit.mjs';
import { validateDocument } from '../../src/findings/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 4176),
  B = `http://127.0.0.1:${PORT}`;
const O = path.resolve(root, process.env.OUT || 'audit-output/fixtures');
const SERIAL = process.env.SERIAL === '1';
const CONC = SERIAL ? 1 : Number(process.env.CONCURRENCY || Math.max(4, defaultConcurrency()));
const L = (...p) => p.map((x) => `${B}/${x}.html`).join(',');
let server,
  timing = {};

const JOBS = [
  ['inventory', 'inventory.mjs', ['--urls', L('index-good', 'ro-good')]],
  ['axe', 'axe-scan.mjs', ['--urls', L('index-good'), '--widths', '390']],
  ['tab-walk', 'tab-walk.mjs', ['--urls', L('index-good')]],
  ['focus-state', 'focus-state.mjs', ['--urls', L('index-good'), '--selector', 'a']],
  ['menu-modal', 'menu-modal.mjs', ['--urls', L('mega-good'), '--trigger', 'button[aria-expanded]', '--width', '1280']],
  ['forms', 'forms.mjs', ['--urls', L('lantern')]],
  ['reflow', 'reflow.mjs', ['--urls', L('index-good')]],
  ['motion', 'motion.mjs', ['--urls', L('carousel-bad')]],
  ['sr-transcript', 'sr-transcript.mjs', ['--urls', L('index-good'), '--max', '200']],
  ['context-change', 'context-change.mjs', ['--urls', L('lantern')]],
  ['sample-compare', 'sample-compare.mjs', ['--urls', L('index-good', 'about', 'help')]],
  // bypass-order: one job per page (the CLI shards the same way); outputs are per-URL files
  ...[
    'ro-bad-flex',
    'ro-bad-order',
    'ro-bad-abs',
    'ro-bad-grid',
    'ro-bad-tabindex',
    'ro-good',
    'bypass-none',
    'bypass-broken-target',
    'bypass-noop',
    'bypass-hidden',
    'bypass-good',
    'bypass-short-good',
  ].map((p) => ['bypass-order', 'bypass-order.mjs', ['--urls', L(p), '--widths', '1440']]),
  // journeys: one job per start page (independent sessions) so the slowest page sets the wall time, not the sum
  ...['mega-bad', 'mega-good', 'cookie-bad', 'overlay-bad', 'carousel-bad', 'timeout-bad', 'targets-bad'].map((p) => [
    'journeys',
    'journeys.mjs',
    ['--urls', L(p), '--target', 'lantern', '--watch', '16'],
  ]),
  ['journeys', 'journeys.mjs', ['--urls', L('carticon-bad'), '--goal', 'checkout', '--personas', 'sr']],
];

before(async () => {
  server = spawn(process.execPath, [path.join(root, 'test/serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.once('data', r));
  fs.rmSync(O, { recursive: true, force: true });
  fs.mkdirSync(O, { recursive: true });
  const t0 = Date.now();
  const browser = SERIAL ? null : await startBrowser();
  const jobs = JOBS.map(([tool, script, args], i) => ({
    id: `${i}-${tool}`,
    tool,
    script: path.join(root, script),
    args: [...args, '--out', O],
    cwd: root,
    logFile: path.join(O, 'logs', `${i}-${tool}.log`),
  }));
  const order = [...jobs].sort((a, b) => (b.tool === 'journeys') - (a.tool === 'journeys'));
  const res = await pool(order, CONC, (j) =>
    runJob(j, { env: browser ? { ADA_BROWSER_WS: browser.wsEndpoint } : {}, timeoutMs: 600000, retries: 1 }),
  );
  await browser?.close();
  timing = {
    wallMs: Date.now() - t0,
    concurrency: CONC,
    sharedBrowser: !SERIAL,
    jobs: res.map((r) => ({ id: r.id, ms: r.ms, ok: r.ok, attempts: r.attempts })),
  };
  fs.writeFileSync(path.join(O, 'timing.json'), JSON.stringify(timing, null, 2));
  for (const r of res) if (!r.ok) console.error(`job ${r.id} failed:\n${r.tail}`);
});
after(() => server?.kill());

const s = `127_0_0_1_${PORT}_`;
const has = (file, re) => fs.existsSync(file) && new RegExp(re, 'm').test(fs.readFileSync(file, 'utf8'));
const BO = (p) => path.join(O, 'bypass-order', `${s}${p}_html_1440.txt`),
  J = (p) => path.join(O, 'journeys', `${s}${p}_html.txt`);

for (const d of [
  'inventory',
  'axe',
  'tab-walk',
  'focus-state',
  'menu-modal',
  'forms',
  'reflow',
  'motion',
  'sr-transcript',
  'context-change',
  'sample-compare',
])
  test(`${d} produced output`, () => assert.ok(fs.existsSync(path.join(O, d)) && fs.readdirSync(path.join(O, d)).length > 0));
for (const p of ['ro_bad_flex', 'ro_bad_order', 'ro_bad_abs', 'ro_bad_grid'])
  test(`reading order flagged: ${p}`, () => assert.ok(has(BO(p), '^READING-ORDER\\?\\(1\\.3\\.2,(high|medium)')));
test('focus-order jump flagged: ro_bad_tabindex', () =>
  assert.ok(has(BO('ro_bad_tabindex'), '^FOCUS-ORDER-JUMP\\?\\(2\\.4\\.3/1\\.3\\.2,high')));
for (const p of ['bypass_none', 'bypass_noop', 'bypass_hidden'])
  test(`bypass none flagged: ${p}`, () => assert.ok(has(BO(p), '^BYPASS-NONE')));
test('skip target missing flagged', () => assert.ok(has(BO('bypass_broken_target'), '^SKIP-TARGET-MISSING')));
for (const p of ['ro_good', 'bypass_good', 'bypass_short_good'])
  test(`clean control stays clean: ${p}`, () => {
    assert.ok(fs.existsSync(BO(p)));
    assert.ok(!has(BO(p), '^(READING-ORDER|FOCUS-ORDER-JUMP|BYPASS-NONE|SKIP-)'));
  });
test('journeys: hover-only menu found', () => assert.ok(has(J('mega_bad'), 'HOVER-ONLY-MENU')));
test('journeys: fixed menu clean', () => {
  assert.ok(fs.existsSync(J('mega_good')));
  assert.ok(!has(J('mega_good'), 'HOVER-ONLY-MENU'));
});
test('journeys: cookie banner trap', () => assert.ok(has(J('cookie_bad'), 'KEYBOARD-TRAP|OVERLAY-NO-KEYBOARD-EXIT')));
test('journeys: overlay without keyboard exit', () => assert.ok(has(J('overlay_bad'), 'OVERLAY-NO-KEYBOARD-EXIT')));
test('journeys: auto-advancing carousel', () => assert.ok(has(J('carousel_bad'), 'AUTO-ADVANCE')));
test('journeys: timed navigation', () => assert.ok(has(J('timeout_bad'), 'TIMED-NAVIGATION')));
test('journeys: target too small', () => assert.ok(has(J('targets_bad'), 'TARGET-TOO-SMALL')));
test('journeys: SR must guess unnamed cart icon', () => assert.ok(has(J('carticon_bad'), 'SR-MUST-GUESS')));
test('journeys: keyboard user reaches goal on fixed menu', () => assert.ok(has(J('mega_good'), 'Keyboard-only user: reached')));
test('every legacy job exited 0', () =>
  assert.deepEqual(
    timing.jobs.filter((j) => !j.ok).map((j) => j.id),
    [],
  ));

// --- unified CLI + findings pipeline on the checkout twins ---
let bad, good;
test('ada-audit CLI: checkout-bad end to end', async () => {
  const out = path.join(O, 'cli-checkout-bad');
  const code = await main(
    [`${B}/checkout-bad.html`, '--out', out, '--widths', '390', '--format', 'json,md,html,sarif,csv', '--concurrency', String(CONC), '-q'],
    { log: () => {} },
  );
  assert.equal(code, 0);
  bad = JSON.parse(fs.readFileSync(path.join(out, 'findings.json'), 'utf8'));
  assert.deepEqual(validateDocument(bad), []);
  for (const f of ['report.md', 'report.html', 'findings.sarif', 'findings.csv']) assert.ok(fs.statSync(path.join(out, f)).size > 500, f);
});
test('checkout-bad: planted barriers become findings with the right SC', () => {
  const sc = new Set(bad.findings.filter((f) => f.kind === 'failure').flatMap((f) => f.wcag.map((w) => w.sc)));
  for (const want of ['1.1.1', '1.3.1', '1.3.5', '1.4.3', '2.4.1', '2.4.7', '3.1.1', '3.2.2', '4.1.2', '1.4.10'])
    assert.ok(sc.has(want), `missing ${want}`);
});
test('checkout-bad: labels found by axe and forms are one deduped finding', () => {
  const f = bad.findings.find((x) => x.remediation.concept === 'form-label');
  assert.ok(f && f.tools.includes('axe') && f.tools.includes('forms') && f.corroborated);
  assert.equal(new Set(f.locations.map((l) => l.target.replace(/^input/, ''))).size, f.locations.length, 'no duplicate element locations');
  assert.equal(f.priority.plan, 'fix-now');
});
test('ada-audit --fail-on gates on candidate failures (exit 1)', async () => {
  const code = await main(['report', path.join(O, 'cli-checkout-bad'), '--fail-on', 'serious', '-q'], { log: () => {} });
  assert.equal(code, 1);
});
test('ada-audit CLI: checkout-good (fixed twin) has none of the planted failures', async () => {
  const out = path.join(O, 'cli-checkout-good');
  assert.equal(
    await main([`${B}/checkout-good.html`, '--out', out, '--widths', '390', '--concurrency', String(CONC), '-q', '--fail-on', 'minor'], {
      log: () => {},
    }),
    0,
  );
  good = JSON.parse(fs.readFileSync(path.join(out, 'findings.json'), 'utf8'));
  assert.deepEqual(
    good.findings.filter((f) => f.kind === 'failure').map((f) => `${f.id} ${f.title}`),
    [],
  );
  assert.match(good.conformance.statement, /^No WCAG 2\.2 Level A\/AA failures were found/);
  assert.doesNotMatch(good.conformance.statement, /\bis (fully )?(compliant|conformant)\b/i);
});
