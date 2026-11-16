import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { buildDocument } from '../../src/findings/document.mjs';
import { validateDocument, SCHEMA } from '../../src/findings/validate.mjs';
const doc = buildDocument(fileURLToPath(new URL('../data/raw-checkout', import.meta.url)), {
  run: { startedAt: '2026-11-15T12:00:00Z', versions: { tool: '4.2.0' } },
});
const jdoc = buildDocument(fileURLToPath(new URL('../data/raw-journeys', import.meta.url)), { run: { versions: {} } });

test('schema compiles under JSON Schema 2020-12 (ajv) and accepts generated documents', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(SCHEMA);
  for (const d of [doc, jdoc]) assert.ok(validate(JSON.parse(JSON.stringify(d))), JSON.stringify(validate.errors?.slice(0, 3)));
});
test('built-in validator agrees with ajv', () => {
  assert.deepEqual(validateDocument(doc), []);
  assert.deepEqual(validateDocument(jdoc), []);
});
test('validator catches broken documents', () => {
  const bad = structuredClone(doc);
  bad.findings[0].severity = 'catastrophic';
  delete bad.findings[1].remediation;
  bad.conformance.claim = true;
  bad.schemaVersion = '2.0.0';
  const errs = validateDocument(bad);
  assert.ok(errs.some((e) => /severity/.test(e)));
  assert.ok(errs.some((e) => /remediation/.test(e)));
  assert.ok(errs.some((e) => /claim/.test(e)));
  assert.ok(errs.some((e) => /schemaVersion/.test(e)));
});
