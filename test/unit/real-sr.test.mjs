import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePhrase, analyzeTranscript } from '../../src/sr/analyze.mjs';
import { normalizeJourney, JourneyError, PASSES } from '../../src/sr/journey.mjs';
import { resolveScreenReader, SrEnvironmentError, transcriptText } from '../../src/sr/driver.mjs';
import { buildDocument } from '../../src/findings/document.mjs';
import { validateDocument } from '../../src/findings/validate.mjs';
import { renderMarkdown } from '../../src/report/markdown.mjs';
import { main, EXIT } from '../../src/cli/ada-audit.mjs';
import { fixture } from '../data/real-sr/make-fixture.mjs';

const pick = (p) => ({ role: p.role, name: p.name, level: p.level });

test('parsePhrase reads NVDA and VoiceOver word orders', () => {
  assert.deepEqual(pick(parsePhrase('heading, level 1, Welcome', ['heading'])), { role: 'heading', name: 'Welcome', level: 1 });
  assert.deepEqual(pick(parsePhrase('Welcome, heading level 2', ['heading'])), { role: 'heading', name: 'Welcome', level: 2 });
  assert.deepEqual(pick(parsePhrase('Name  edit  has auto complete  blank', ['textbox'])), { role: 'textbox', name: 'Name', level: null });
  assert.deepEqual(pick(parsePhrase('edit  blank', ['textbox'])), { role: 'textbox', name: '', level: null });
  assert.deepEqual(pick(parsePhrase('Submit button', ['button'])), { role: 'button', name: 'Submit', level: null });
  assert.deepEqual(pick(parsePhrase('button', ['button'])), { role: 'button', name: '', level: null });
  assert.equal(parsePhrase('no next heading', ['heading']).end, true);
});
test('parsePhrase keeps names that contain role words', () => {
  assert.equal(parsePhrase('link, Search', ['link']).name, 'Search');
  assert.equal(parsePhrase('Main, link', ['link']).name, 'Main');
  assert.equal(parsePhrase('navigation landmark, Main menu', ['landmark']).name, 'Main menu');
  assert.equal(parsePhrase('Image of the main page, image', ['image']).name, 'Image of the main page');
  assert.equal(parsePhrase('link, graphic, logo.gif', ['link']).name, 'logo.gif');
});

test('analyzeTranscript maps what was heard to rule codes', () => {
  const { flags, stats, errors } = analyzeTranscript(fixture());
  const codes = flags.map((f) => f.code);
  for (const c of [
    'NO-HEADINGS',
    'NO-MAIN',
    'NO-BYPASS',
    'FIELD-NO-LABEL',
    'NO-NAME',
    'VAGUE-LINK',
    'LINK-FILENAME',
    'IMG-NO-ALT',
    'IMG-FILENAME',
    'IMG-VAGUE-ALT',
    'FOCUS-REMOVED',
    'ERRORS-NOT-TESTED',
  ])
    assert.ok(codes.includes(c), `missing ${c}: ${codes.join(',')}`);
  // the unlabeled select announces its value, not a label: the Tab pass DOM fact catches it
  assert.ok(flags.some((f) => f.code === 'FIELD-NO-LABEL' && f.target === 'select#menu'));
  // the labelled email field and the named "Send" button and described photo are not flagged
  assert.ok(!flags.some((f) => /Email|Send|Fresh bread/.test(f.detail) && f.code !== 'ERRORS-NOT-TESTED'));
  // trailing repeats are one link, so "Search" is counted once
  assert.equal(stats.links, 4);
  assert.equal(errors.length, 0);
  assert.ok(flags.every((f) => f.detail.includes('[NVDA]')));
});
test('a failed pass is an error, never a clean result', () => {
  const t = fixture();
  t.passes[0] = { pass: 'headings', endReason: 'error', steps: [], error: 'NVDA did not respond' };
  const { flags, errors } = analyzeTranscript(t);
  assert.ok(!flags.some((f) => f.code === 'NO-HEADINGS'));
  assert.match(errors[0], /headings pass .* did not run: NVDA did not respond/);
});

test('journeys: defaults, overrides and validation', () => {
  const j = normalizeJourney({ url: 'https://a.test/' });
  assert.deepEqual(
    j.steps.map((s) => s.pass),
    PASSES,
  );
  const k = normalizeJourney({ urls: ['https://a.test/'], steps: ['headings', { pass: 'links', max: 5 }] }, { urls: ['https://b.test/'] });
  assert.deepEqual(k.urls, ['https://b.test/']);
  assert.equal(k.steps[1].max, 5);
  for (const bad of [{}, { url: 'ftp://x' }, { url: 'https://a.test', steps: ['dance'] }, { url: 'https://a.test', max: 0 }])
    assert.throws(() => normalizeJourney(bad), JourneyError);
});
test('screen reader resolution follows the OS', () => {
  assert.equal(resolveScreenReader('auto', 'win32'), 'nvda');
  assert.equal(resolveScreenReader('auto', 'darwin'), 'voiceover');
  assert.throws(() => resolveScreenReader('auto', 'linux'), SrEnvironmentError);
  assert.throws(() => resolveScreenReader('nvda', 'darwin'), SrEnvironmentError);
});

test('real-sr transcripts become findings with method real-screen-reader, schema-valid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-realsr-'));
  fs.mkdirSync(path.join(dir, 'real-sr'));
  const t = fixture();
  fs.writeFileSync(path.join(dir, 'real-sr', 'nvda-chromium-shop.json'), JSON.stringify(t));
  fs.writeFileSync(path.join(dir, 'real-sr', 'nvda-chromium-shop.txt'), transcriptText(t));
  const doc = buildDocument(dir, { run: { pages: [t.url], tools: [] } });
  assert.deepEqual(validateDocument(doc), []);
  assert.ok(doc.run.tools.includes('real-sr'));
  assert.equal(doc.realScreenReader.length, 1);
  assert.equal(doc.realScreenReader[0].transcript, path.join('real-sr', 'nvda-chromium-shop.txt'));
  const label = doc.findings.find((f) => f.group === 'form-label');
  assert.ok(label.methods.includes('real-screen-reader'));
  assert.ok(!label.methods.includes('simulated-screen-reader'));
  assert.ok(label.locations[0].evidence.every((e) => e.method === 'real-screen-reader'));
  assert.match(label.howFound[0], /^Real screen reader \(NVDA 2026\.3 \+ chromium 140\.0\)/);
  const md = renderMarkdown(doc, { outDir: dir });
  assert.match(md, /5a\. Real screen-reader runs/);
  assert.doesNotMatch(md, /No real screen reader \(JAWS, NVDA/);
});

test('ada-audit sr: help, dry run and usage errors', async () => {
  let out = '';
  const io = { stdout: (s) => (out += s), log: () => {} };
  assert.equal(await main(['sr', '--help'], io), EXIT.OK);
  assert.match(out, /REAL screen-reader transcript/);
  out = '';
  assert.equal(await main(['sr', '--url', 'https://a.test/', '--dry-run', '--sr', 'nvda'], io), EXIT.OK);
  assert.equal(JSON.parse(out).journey.urls[0], 'https://a.test/');
  for (const argv of [['sr'], ['sr', '--url', 'nope'], ['sr', '--url', 'https://a.test', '--browser', 'lynx'], ['sr', '--bogus']])
    assert.equal(await main(argv, io), EXIT.USAGE, argv.join(' '));
  if (process.platform === 'linux') assert.equal(await main(['sr', '--url', 'https://a.test/'], io), EXIT.USAGE);
});

test('parsePhrase handles VoiceOver run-together speech seen on macOS 15', () => {
  const combo = parsePhrase('QUICKMENU ----> collapsed pop up button', ['combobox']);
  assert.equal(combo.role, 'combobox');
  assert.equal(combo.name, 'QUICKMENU ---->');
  assert.ok(combo.states.includes('collapsed'));
  const link = parsePhrase('nav_home.gif link image', ['link']);
  assert.equal(link.role, 'link');
  assert.match(link.name, /nav_home\.gif/);
  assert.equal(parsePhrase('Landmark not found', ['landmark']).end, true);
  assert.equal(
    parsePhrase('You are currently on a link. To click this link, press Control-Option-Space.', ['link']).raw !== undefined,
    true,
  );
});

test('analyzeTranscript flags VoiceOver file-name links and images and vague links', () => {
  const step = (spoken) => ({ phrases: [spoken], last: spoken, ms: 5 });
  const t = {
    schema: 'ada-real-sr/1',
    screenReader: { id: 'voiceover', name: 'VoiceOver' },
    browser: { name: 'webkit' },
    url: 'https://a.test/',
    title: 'A',
    passes: [
      { pass: 'headings', endReason: 'stall', steps: [step('heading level 1 Title')] },
      { pass: 'landmarks', endReason: 'end', steps: [step('Landmark not found')] },
      { pass: 'links', endReason: 'stall', steps: [step('news.html link'), step('Click here link'), step('nav_home.gif link image')] },
      { pass: 'graphics', endReason: 'stall', steps: [step('border_top.gif image'), step('bullet image')] },
    ],
    links: [],
    images: [],
  };
  const codes = analyzeTranscript(t).flags.map((f) => f.code);
  for (const c of ['NO-MAIN', 'LINK-FILENAME', 'VAGUE-LINK', 'IMG-FILENAME', 'IMG-VAGUE-ALT']) assert.ok(codes.includes(c), c);
  const details = analyzeTranscript(t)
    .flags.map((f) => f.detail)
    .join('\n');
  assert.match(details, /\[VoiceOver\]/);
  assert.match(details, /news\.html link/);
});
