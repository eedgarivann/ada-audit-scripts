import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { collectRaw, ADAPTERS } from '../../src/findings/adapters.mjs';
const DATA = fileURLToPath(new URL('../data/raw-checkout', import.meta.url));
const JDATA = fileURLToPath(new URL('../data/raw-journeys', import.meta.url));
const raws = collectRaw(DATA);
const count = (id) => raws.filter((r) => r.ruleId === id).length;

test('every tool folder with candidates in the sample is read (motion found none)', () => {
  assert.deepEqual([...new Set(raws.map((r) => r.tool))].sort(), [
    'axe',
    'bypass-order',
    'context-change',
    'forms',
    'inventory',
    'reflow',
    'sr-transcript',
    'tab-walk',
  ]);
  assert.equal(raws.filter((r) => r.ruleId === '_meta/adapter-error').length, 0);
});
test('axe: one candidate per violating node, with SCs from tags and help URL', () => {
  const lab = raws.filter((r) => r.ruleId === 'axe/label');
  assert.equal(lab.length, 2);
  assert.deepEqual(lab[0].axe.sc, ['4.1.2']);
  assert.match(lab[0].helpUrl, /dequeuniversity\.com\/rules\/axe\/.+\/label/);
});
test('forms: field lines parsed, SUMMARY line not double counted', () => {
  assert.equal(count('forms/no-label'), 2);
  assert.equal(count('forms/no-autocomplete'), 4);
  assert.deepEqual(
    raws
      .filter((r) => r.ruleId === 'forms/no-label')
      .map((r) => r.target)
      .sort(),
    ['input#name', 'input#phone'],
  );
});
test('sr-transcript: identical empty names in a Tab pass are not reported as a trap', () => assert.equal(count('sr-transcript/repeat'), 0));
test('tab-walk: contrast of an element with no text is dropped; walk completion recorded', () => {
  assert.equal(raws.filter((r) => r.ruleId === 'tab-walk/text' && / ""$/.test(r.target || '')).length, 0);
  assert.equal(count('_meta/walk-complete'), 1);
});
test('header parsing gives URL and width', () => {
  const r = raws.find((x) => x.tool === 'bypass-order');
  assert.match(r.url, /checkout-bad\.html$/);
  assert.equal(r.width, 390);
  assert.equal(raws.find((x) => x.tool === 'sr-transcript').width, 390);
});
test('journeys: issues carry persona, outcome and screenshot path', () => {
  const j = ADAPTERS.journeys(JDATA);
  const trap = j.find((x) => x.ruleId === 'journeys/keyboard-trap');
  assert.equal(trap.persona, 'keyboard');
  assert.equal(trap.outcome, 'stuck');
  assert.equal(trap.toolConfidence, 'high');
  assert.match(trap.screenshot, /keyboard_02_trapped\.png$/);
});
