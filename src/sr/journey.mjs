// Real screen-reader journey files: which pages to visit and which screen-reader passes to record.
// A journey is read-only: passes only move the screen-reader cursor or press Tab; nothing is activated or submitted.
import fs from 'node:fs';

/** Every pass the driver knows, in the order a screen-reader user usually orients on a page. */
export const PASSES = ['headings', 'landmarks', 'formFields', 'buttons', 'links', 'graphics', 'tab'];
export const PASS_LABEL = {
  headings: 'Headings (quick-nav)',
  landmarks: 'Landmarks (quick-nav)',
  formFields: 'Form fields (quick-nav)',
  buttons: 'Buttons (quick-nav)',
  links: 'Links (quick-nav)',
  graphics: 'Graphics (quick-nav)',
  tab: 'Tab order (keyboard focus)',
};
/** Default per-pass item caps (a pass stops earlier when the screen reader says there is no next item). */
export const DEFAULT_MAX = { headings: 40, landmarks: 20, formFields: 40, buttons: 30, links: 60, graphics: 40, tab: 60 };
export const DEFAULT_JOURNEY = { name: 'Orientation: headings, landmarks, fields, buttons, links, graphics, Tab', steps: PASSES };

export class JourneyError extends Error {
  name = 'JourneyError';
}

/**
 * Validate a journey object and fill defaults.
 * Shape: { name, urls?: string[] | url?: string, steps?: (string | {pass, max})[], max?: number }
 * @returns {{name:string, urls:string[], steps:{pass:string,max:number}[]}}
 */
export function normalizeJourney(j = {}, { urls: override = [], max } = {}) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new JourneyError('journey must be a JSON object');
  const name = typeof j.name === 'string' && j.name.trim() ? j.name.trim() : DEFAULT_JOURNEY.name;
  const urls = override.length ? override : [...(j.url ? [j.url] : []), ...(Array.isArray(j.urls) ? j.urls : [])];
  if (!urls.length) throw new JourneyError('give a URL (--url or "url"/"urls" in the journey file)');
  for (const u of urls) {
    let ok = false;
    try {
      ok = /^https?:$/.test(new URL(u).protocol);
    } catch {
      ok = false;
    }
    if (!ok) throw new JourneyError(`not an http(s) URL: ${u}`);
  }
  const cap = max ?? j.max;
  if (cap !== undefined && (!Number.isInteger(Number(cap)) || Number(cap) < 1 || Number(cap) > 500))
    throw new JourneyError('max must be a whole number from 1 to 500');
  const raw = j.steps === undefined ? DEFAULT_JOURNEY.steps : j.steps;
  if (!Array.isArray(raw) || !raw.length) throw new JourneyError('"steps" must be a non-empty array');
  const steps = raw.map((s) => {
    const pass = typeof s === 'string' ? s : s?.pass;
    if (!PASSES.includes(pass)) throw new JourneyError(`unknown step "${pass}" (use ${PASSES.join(', ')})`);
    const m = typeof s === 'object' && s.max !== undefined ? Number(s.max) : cap !== undefined ? Number(cap) : DEFAULT_MAX[pass];
    if (!Number.isInteger(m) || m < 1 || m > 500) throw new JourneyError(`max for "${pass}" must be 1-500`);
    return { pass, max: m };
  });
  return { name, urls: [...new Set(urls)], steps };
}

export function loadJourney(file, opts) {
  if (!file) return normalizeJourney({}, opts);
  if (!fs.existsSync(file)) throw new JourneyError(`journey file not found: ${file}`);
  let j;
  try {
    j = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new JourneyError(`journey file is not valid JSON: ${e.message}`);
  }
  return normalizeJourney(j, opts);
}
