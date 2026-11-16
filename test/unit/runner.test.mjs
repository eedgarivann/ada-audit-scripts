import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pool, runJob, mergeShard } from '../../src/core/runner.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-run-'));
const script = (name, body) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, body);
  return f;
};

test('pool keeps input order and never exceeds the limit', async () => {
  let live = 0,
    peak = 0;
  const out = await pool([5, 1, 4, 2, 3], 2, async (x) => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, x * 5));
    live--;
    return x * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
});
test('runJob retries a crashed job once, then succeeds', async () => {
  const flag = path.join(tmp, 'flag');
  const f = script(
    'flaky.mjs',
    `import fs from 'node:fs'; if (!fs.existsSync(${JSON.stringify(flag)})) { fs.writeFileSync(${JSON.stringify(flag)}, '1'); throw new Error('flaky'); } console.log('ok');`,
  );
  const r = await runJob({ id: 'f', tool: 't', script: f, args: [] }, { retries: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});
test('runJob does not retry usage errors and kills jobs that time out', async () => {
  const u = script('usage.mjs', `console.error('usage: node x.mjs --urls'); process.exit(1);`);
  const r = await runJob({ id: 'u', tool: 't', script: u, args: [] }, { retries: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1);
  const h = script('hang.mjs', `setTimeout(() => {}, 60000);`);
  const t = await runJob({ id: 'h', tool: 't', script: h, args: [] }, { timeoutMs: 300, retries: 0 });
  assert.equal(t.timedOut, true);
  assert.equal(t.code, 124);
});
test('mergeShard moves files and concatenates summaries without repeating headers', () => {
  const out = path.join(tmp, 'out'),
    a = path.join(tmp, 'sa'),
    b = path.join(tmp, 'sb');
  for (const [d, row] of [
    [a, 'u1\tx'],
    [b, 'u2\ty'],
  ]) {
    fs.mkdirSync(path.join(d, 'axe'), { recursive: true });
    fs.writeFileSync(path.join(d, 'axe', 'summary.tsv'), `# axe-scan header\nurl\tw\n${row}\n`);
    fs.writeFileSync(path.join(d, 'axe', `${row.slice(0, 2)}.json`), '{}');
  }
  mergeShard(a, out);
  mergeShard(b, out);
  assert.equal(fs.readFileSync(path.join(out, 'axe', 'summary.tsv'), 'utf8'), '# axe-scan header\nurl\tw\nu1\tx\nu2\ty\n');
  assert.deepEqual(fs.readdirSync(path.join(out, 'axe')).sort(), ['summary.tsv', 'u1.json', 'u2.json']);
  assert.equal(fs.existsSync(a), false);
});
