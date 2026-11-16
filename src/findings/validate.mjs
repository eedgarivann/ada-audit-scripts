// Dependency-free validator for the subset of JSON Schema used by schema/findings.schema.json
// (type, required, properties, items, enum, const, pattern, minimum/maximum, minItems, minLength, $ref, additionalProperties-as-schema).
import fs from 'node:fs';
const SCHEMA = JSON.parse(fs.readFileSync(new URL('../../schema/findings.schema.json', import.meta.url), 'utf8'));
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number');

function check(v, s, at, errs) {
  if (s.$ref)
    s = s.$ref
      .split('/')
      .slice(1)
      .reduce((o, k) => o[k], SCHEMA);
  if (s.type && ![].concat(s.type).some((t) => isType(v, t)))
    return errs.push(`${at}: expected ${[].concat(s.type).join('|')}, got ${typeOf(v)}`);
  if ('const' in s && v !== s.const) errs.push(`${at}: must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) errs.push(`${at}: "${v}" not in ${s.enum.join(', ')}`);
  if (typeof v === 'string') {
    if (s.pattern && !new RegExp(s.pattern).test(v)) errs.push(`${at}: "${v}" does not match ${s.pattern}`);
    if (s.minLength && v.length < s.minLength) errs.push(`${at}: too short`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) errs.push(`${at}: < ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) errs.push(`${at}: > ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems && v.length < s.minItems) errs.push(`${at}: needs ≥${s.minItems} item(s)`);
    if (s.items) v.forEach((x, i) => check(x, s.items, `${at}[${i}]`, errs));
  }
  if (typeOf(v) === 'object') {
    for (const r of s.required || []) if (!(r in v)) errs.push(`${at}: missing "${r}"`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) check(x, s.properties[k], `${at}.${k}`, errs);
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') check(x, s.additionalProperties, `${at}.${k}`, errs);
    }
  }
}
/** @returns {string[]} error messages; empty when valid */
export function validateDocument(doc) {
  const errs = [];
  check(doc, SCHEMA, '$', errs);
  return errs;
}
export { SCHEMA };
