import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { collectRaw } from '../../src/findings/adapters.mjs';
import { buildFindings, summarize, targetKey, normUrl } from '../../src/findings/model.mjs';
const DATA = fileURLToPath(new URL('../data/raw-checkout', import.meta.url));
const JDATA = fileURLToPath(new URL('../data/raw-journeys', import.meta.url));
const U = 'http://127.0.0.1:4176/checkout-bad.html';
const raw = (o) => ({ url: U, width: 390, target: null, detail: o.ruleId, file: 'x', ...o });

test('targetKey treats #id and tag#id as the same element; normUrl drops hash and trailing slash', () => {
  assert.equal(targetKey('#zip'), targetKey('input#zip'));
  assert.notEqual(targetKey('div.icon'), targetKey('div.other'));
  assert.equal(normUrl('https://a.test/x/#top'), 'https://a.test/x');
});
test('dedupe: axe "label" and forms NO-LABEL merge into one corroborated finding with unique locations', () => {
  const { findings } = buildFindings(collectRaw(DATA));
  const f = findings.filter((x) => x.remediation.concept === 'form-label');
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].tools, ['axe', 'forms']);
  assert.ok(f[0].corroborated);
  assert.equal(f[0].confidence, 'automated-certain');
  assert.equal(f[0].locations.length, new Set(f[0].locations.map((l) => targetKey(l.target))).size);
});
test('dedupe across tools: page language from axe + inventory is one finding', () => {
  const { findings } = buildFindings(collectRaw(DATA));
  const f = findings.filter((x) => x.wcag.some((w) => w.sc === '3.1.1'));
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].tools, ['axe', 'inventory']);
});
test('severity is the max and confidence the strongest across merged sources', () => {
  const { findings } = buildFindings([
    raw({ tool: 'sr-transcript', ruleId: 'sr-transcript/no-name', target: 'button' }),
    raw({
      tool: 'axe',
      ruleId: 'axe/button-name',
      target: 'button.icon',
      axe: { id: 'button-name', impact: 'critical', sc: ['4.1.2'], kind: 'failure' },
    }),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'critical');
  assert.equal(findings[0].confidence, 'automated-certain');
});
test('contradiction check: a Tab-pass "trap" is suppressed when the full tab walk completed', () => {
  const { findings, suppressed } = buildFindings([
    raw({ tool: 'sr-transcript', ruleId: 'sr-transcript/repeat' }),
    raw({ tool: 'tab-walk', ruleId: '_meta/walk-complete' }),
  ]);
  assert.equal(findings.length, 0);
  assert.equal(suppressed.length, 1);
  assert.equal(buildFindings([raw({ tool: 'sr-transcript', ruleId: 'sr-transcript/repeat' })]).findings.length, 1);
});
test('tool confidence "low" downgrades to inferred and lowers severity one step', () => {
  const { findings } = buildFindings([raw({ tool: 'bypass-order', ruleId: 'bypass-order/reading-order', toolConfidence: 'low' })]);
  assert.equal(findings[0].confidence, 'inferred');
  assert.equal(findings[0].severity, 'moderate');
});
test('a simulated persona stuck on a barrier makes it a blocker, rung 1, Fix now', () => {
  const { findings } = buildFindings(collectRaw(JDATA));
  const trap = findings.find((f) => f.remediation.concept === 'keyboard-trap');
  assert.equal(trap.severity, 'blocker');
  assert.equal(trap.priority.rung, 1);
  assert.equal(trap.priority.plan, 'fix-now');
  assert.ok(trap.impact.simulatedOutcomes.includes('keyboard: stuck'));
  assert.equal(findings[0].id, 'F-001');
  assert.equal(findings[0].priority.plan, 'fix-now');
});
test('plan follows the ladder: named journeys lower priority of pages off the journey', () => {
  const r = [raw({ tool: 'inventory', ruleId: 'inventory/alt-missing', target: 'img' })];
  const on = buildFindings(r).findings[0];
  const off = buildFindings(r, { journeys: [{ name: 'Checkout', urls: ['http://127.0.0.1:4176/cart.html'] }] }).findings[0];
  assert.equal(on.onCriticalJourney, true);
  assert.equal(off.onCriticalJourney, false);
  assert.ok(on.priority.score > off.priority.score);
  assert.notEqual(off.priority.plan, 'fix-now');
});
test('non-failures never enter Fix now and score 0', () => {
  const { findings } = buildFindings(collectRaw(DATA));
  for (const f of findings.filter((x) => x.kind !== 'failure')) {
    assert.equal(f.priority.plan, 'monitor');
    assert.equal(f.priority.score, 0);
  }
});
test('ordering: Fix now before Fix next before Monitor, then by score', () => {
  const { findings } = buildFindings(collectRaw(DATA));
  const order = { 'fix-now': 0, 'fix-next': 1, monitor: 2 };
  const fail = findings.filter((f) => f.kind === 'failure');
  for (let i = 1; i < fail.length; i++) {
    const a = fail[i - 1],
      b = fail[i];
    assert.ok(
      order[a.priority.plan] < order[b.priority.plan] || (a.priority.plan === b.priority.plan && a.priority.score >= b.priority.score),
      `${a.id} before ${b.id}`,
    );
  }
  assert.ok(findings.findIndex((f) => f.kind !== 'failure') > fail.length - 1);
});
test('deterministic: same input gives identical findings, IDs and fingerprints', () => {
  const a = JSON.stringify(buildFindings(collectRaw(DATA))),
    b = JSON.stringify(buildFindings(collectRaw(DATA)));
  assert.equal(a, b);
  const { findings } = buildFindings(collectRaw(DATA));
  findings.forEach((f, i) => assert.equal(f.id, `F-${String(i + 1).padStart(3, '0')}`));
});
test('summary counts add up', () => {
  const { findings, suppressed } = buildFindings(collectRaw(DATA));
  const s = summarize(findings, suppressed);
  assert.equal(s.total, findings.length);
  assert.equal(
    Object.values(s.byPlan).reduce((a, b) => a + b, 0),
    s.failures,
  );
  assert.equal(
    Object.values(s.byKind).reduce((a, b) => a + b, 0),
    s.total,
  );
  assert.ok(s.failuresConfirmedByRules <= s.failures);
});

test('summarize counts a page once despite trailing slash or ":" suffix', () => {
  const f = (urls) => ({
    kind: 'failure',
    confidence: 'needs-review',
    severity: 'serious',
    effort: 'low',
    priority: { plan: 'fix-next' },
    locations: urls.map((url) => ({ url })),
  });
  const s = summarize([f(['https://a.test', 'https://a.test/:', 'https://a.test/']), f(['https://a.test/b', 'https://a.test/b/:12'])]);
  assert.equal(s.pagesWithFindings, 2);
});
