import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, resolveOptions, planJobs, gate, EXIT, VERSION } from '../../src/cli/ada-audit.mjs';
const DATA = fileURLToPath(new URL('../data/raw-checkout', import.meta.url));
const quiet = { log: () => {}, stdout: () => {} };
const capture = () => {
  let s = '';
  return {
    stdout: (x) => {
      s += x;
    },
    log: () => {},
    get out() {
      return s;
    },
  };
};

test('--version and --help exit 0', async () => {
  const c = capture();
  assert.equal(await main(['--version'], c), EXIT.OK);
  assert.equal(c.out.trim(), VERSION);
  assert.equal(await main(['--help'], quiet), EXIT.OK);
});
test('usage errors exit 2', async () => {
  for (const argv of [
    [],
    ['not-a-url'],
    ['https://a.test', '--format', 'pdf'],
    ['https://a.test', '--platform', 'geocities'],
    ['https://a.test', '--fail-on', 'huge'],
    ['https://a.test', '--bogus'],
    ['https://a.test', '--tools', 'nope'],
    ['https://a.test', '--widths', '10'],
  ])
    assert.equal(await main(argv, quiet), EXIT.USAGE, argv.join(' '));
});
test('tools and rules list as JSON', async () => {
  const c = capture();
  await main(['tools', '--json'], c);
  const t = JSON.parse(c.out);
  assert.ok(t.find((x) => x.name === 'journeys' && x.default === false));
  const r = capture();
  await main(['rules', '--json'], r);
  assert.ok(JSON.parse(r.out).length > 100);
});
test('config file + flags: flags win; journeys parsed', () => {
  const f = path.join(os.tmpdir(), `ada-cfg-${process.pid}.json`);
  fs.writeFileSync(
    f,
    JSON.stringify({
      urls: ['https://a.test/'],
      widths: [320],
      platform: 'wix',
      journeys: [{ name: 'Donate', urls: ['https://a.test/donate'] }],
    }),
  );
  const o = resolveOptions({ config: f, platform: 'shopify', journey: ['Contact=https://a.test/contact'] }, ['https://a.test/b']);
  // Journey pages are always audited, even when not in "urls".
  assert.deepEqual(o.urls, ['https://a.test/', 'https://a.test/b', 'https://a.test/donate', 'https://a.test/contact']);
  assert.equal(o.platform, 'shopify');
  assert.deepEqual(o.widths, [320]);
  assert.deepEqual(
    o.journeys.map((j) => j.name),
    ['Donate', 'Contact'],
  );
  fs.rmSync(f);
});
test('option validation rejects bad numbers and malformed journeys (exit 2 class)', () => {
  const bad = [
    [{ concurrency: '0' }, /concurrency/],
    [{ concurrency: '2.5' }, /concurrency/],
    [{ retries: '-1' }, /retries/],
    [{ timeout: '10' }, /timeout/],
    [{ widths: '100' }, /widths/],
    [{ 'fail-on': 'fatal' }, /fail-on/],
    [{ format: 'pdf' }, /format/],
    [{ journey: ['no-equals-sign'] }, /journey/],
  ];
  for (const [v, re] of bad)
    assert.throws(
      () => resolveOptions(v, ['https://a.test/']),
      (e) => e.name === 'UsageError' && re.test(e.message),
    );
  const f = path.join(os.tmpdir(), `ada-cfg-bad-${process.pid}.json`);
  fs.writeFileSync(f, JSON.stringify({ urls: ['https://a.test/'], journeys: [{ urls: [] }] }));
  assert.throws(() => resolveOptions({ config: f }, []), /journey needs a "name"/);
  fs.rmSync(f);
});
test('planJobs: one job per URL for shardable tools, per width for tab-walk, one for sample-compare', () => {
  const o = resolveOptions({ widths: '390,1440' }, ['https://a.test/', 'https://a.test/b']);
  const jobs = planJobs(o);
  assert.equal(jobs.filter((j) => j.tool === 'axe').length, 2);
  assert.equal(jobs.filter((j) => j.tool === 'tab-walk').length, 4);
  assert.equal(jobs.filter((j) => j.tool === 'sample-compare').length, 1);
  assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length);
  assert.ok(jobs.every((j) => j.args.includes('--out')));
  assert.equal(planJobs(resolveOptions({}, ['https://a.test/'])).filter((j) => j.tool === 'sample-compare').length, 0);
});
test('journeys run on named journey start pages with their goal', () => {
  const o = resolveOptions({ journeys: true, goal: 'buy', journey: ['Checkout=https://a.test/cart,https://a.test/checkout'] }, [
    'https://a.test/',
  ]);
  const j = planJobs(o).filter((x) => x.tool === 'journeys');
  assert.equal(j.length, 1);
  assert.ok(j[0].args.includes('https://a.test/cart'));
});
test('gate: --fail-on counts failures at or above the threshold, ignores inferred', () => {
  const doc = {
    findings: [
      { kind: 'failure', severity: 'moderate', confidence: 'needs-review' },
      { kind: 'failure', severity: 'critical', confidence: 'inferred' },
      { kind: 'best-practice', severity: 'critical', confidence: 'automated-certain' },
    ],
  };
  assert.equal(gate(doc, null), EXIT.OK);
  assert.equal(gate(doc, 'serious'), EXIT.OK);
  assert.equal(gate(doc, 'moderate'), EXIT.FINDINGS);
});
test('report subcommand rebuilds reports from an existing (legacy) output folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-cli-'));
  fs.cpSync(DATA, dir, { recursive: true });
  assert.equal(await main(['report', dir, '--format', 'json,md,html,sarif,csv'], quiet), EXIT.OK);
  for (const f of ['findings.json', 'report.md', 'report.html', 'findings.sarif', 'findings.csv'])
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  const c = capture();
  assert.equal(await main(['validate', path.join(dir, 'findings.json')], c), EXIT.OK);
  assert.match(c.out, /^valid/);
  fs.rmSync(dir, { recursive: true });
});
