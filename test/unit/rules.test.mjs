import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, AXE_CONCEPT, rulesFor, ruleRegex } from '../../src/findings/rules.mjs';
import { REMEDIES } from '../../src/findings/remediation.mjs';
import { SC, scRef, scFromAxeTag } from '../../src/findings/wcag.mjs';

test('rule ids are unique', () => assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length));
test('every rule and axe concept has a remedy with steps and a verify check', () => {
  for (const c of new Set([...RULES.map((r) => r.concept), ...Object.values(AXE_CONCEPT)])) {
    assert.ok(REMEDIES[c], `remedy for ${c}`);
    assert.ok(REMEDIES[c].steps.length && REMEDIES[c].verify && REMEDIES[c].who, c);
    assert.ok([1, 2, 3, 4, 5].includes(REMEDIES[c].rung) && ['low', 'medium', 'high'].includes(REMEDIES[c].effort), c);
  }
});
test('every SC used by a rule exists in the WCAG 2.2 table', () => {
  for (const r of RULES) for (const s of r.sc) assert.ok(SC[s], `${r.id} -> ${s}`);
});
test('failures cite at least one SC; best practices and advisories cite no AA SC', () => {
  for (const r of RULES) {
    if (r.kind === 'failure') assert.ok(r.sc.length, r.id);
    if (r.kind === 'aaa')
      assert.ok(
        r.sc.every((s) => SC[s][1] === 'AAA'),
        r.id,
      );
    if (['best-practice', 'advisory'].includes(r.kind))
      assert.deepEqual(
        r.sc.filter((s) => SC[s][1] !== 'AAA'),
        [],
        r.id,
      );
  }
});
test('WCAG 2.2 table omits obsolete 4.1.1 and links Understanding docs', () => {
  assert.equal(SC['4.1.1'], undefined);
  assert.equal(scRef('2.4.11').url, 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html');
  assert.equal(scFromAxeTag('wcag2411'), '2.4.11');
  assert.equal(scFromAxeTag('wcag143'), '1.4.3');
  assert.equal(scFromAxeTag('best-practice'), null);
});
test('code matching takes whole tokens, longest first', () => {
  const tw = rulesFor('tab-walk');
  const hit = (line) => tw.filter((r) => ruleRegex(r).test(line)).map((r) => r.code);
  assert.deepEqual(hit('3\ta\t"x"\t\tring=NONE\tPARTLY-COVERED(2/5)'), ['PARTLY-COVERED']);
  assert.deepEqual(hit('3\ta\t"x"\t\tring=NONE\tNO-RING? COVERED(entire?)').sort(), ['COVERED', 'NO-RING?']);
  const f = rulesFor('forms');
  assert.deepEqual(
    f.filter((r) => ruleRegex(r).test('PASTE-BLOCKED(bp) pw')).map((r) => r.code),
    ['PASTE-BLOCKED(bp)'],
  );
  assert.deepEqual(
    f.filter((r) => ruleRegex(r).test('PASTE-BLOCKED(3.3.8: blocks password managers/copying) pw')).map((r) => r.code),
    ['PASTE-BLOCKED'],
  );
});
