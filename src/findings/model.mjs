// Unified findings model: normalise raw candidates -> dedupe across tools/pages -> score -> plan -> stable IDs.
// Output conforms to schema/findings.schema.json (schemaVersion below). Pure and deterministic for the same input.
import crypto from 'node:crypto';
import { RULES, AXE_CONCEPT, AXE_GROUP, AXE_IMPACT, groupOf } from './rules.mjs';
import { REMEDIES } from './remediation.mjs';
import { scRef } from './wcag.mjs';

export const SCHEMA_VERSION = '1.0.0';
export const SEVERITIES = ['blocker', 'critical', 'serious', 'moderate', 'minor'];
export const CONFIDENCES = ['automated-certain', 'needs-review', 'inferred'];
export const PLANS = ['fix-now', 'fix-next', 'monitor'];
const SEV_W = { blocker: 100, critical: 60, serious: 30, moderate: 10, minor: 3 };
const CONF_W = { 'automated-certain': 1, 'needs-review': 0.7, inferred: 0.4 };
const EFFORT_COST = { low: 1, medium: 3, high: 8 };
const KIND_ORDER = ['failure', 'not-tested', 'best-practice', 'aaa', 'advisory', 'other-risk'];
const ruleById = new Map(RULES.map((r) => [r.id, r]));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const sevMax = (a, b) => (SEVERITIES.indexOf(a) <= SEVERITIES.indexOf(b) ? a : b);
const sevStep = (s, d) => SEVERITIES[Math.min(SEVERITIES.length - 1, Math.max(0, SEVERITIES.indexOf(s) + d))];
export function normUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href.replace(/\/$/, '');
  } catch {
    return u;
  }
}

const HOW_FOUND = {
  axe: (v) => `Automated (axe-core ${v.axe || ''})`.trim(),
  'sr-transcript': (v) => `Simulated SR (Guidepup Virtual Screen Reader ${v.vsr || ''})`.trim(),
  journeys: () => 'Simulated persona journey (scripted; not user testing)',
  'tab-walk': (v) => `Keyboard test (scripted, Chromium ${v.playwright ? 'via Playwright ' + v.playwright : ''})`.trim(),
  'focus-state': () => 'Keyboard test (scripted focus/hover states)',
  'menu-modal': () => 'Keyboard test (scripted menu/dialog)',
  forms: () => 'Accessibility tree + DOM inspection (scripted)',
  reflow: () => 'Zoom/reflow (scripted 320 px + text spacing)',
  motion: () => 'Automated motion check (scripted)',
  inventory: () => 'DOM inspection (scripted)',
  'context-change': () => 'Keyboard/DOM test (scripted, navigations aborted)',
  'sample-compare': () => 'Cross-page comparison (scripted)',
  'bypass-order': () => 'Keyboard + layout test (scripted)',
};

/** Resolve the catalog rule for a raw candidate (axe rules are synthesised from axe tags). */
export function resolveRule(raw) {
  if (raw.tool === 'axe' && raw.axe) {
    const a = raw.axe;
    const concept = AXE_CONCEPT[a.id] || 'axe-other';
    const group = AXE_GROUP[a.id] || (a.kind === 'failure' ? `${concept}:${a.sc[0] || '-'}:${a.kind}` : `${concept}:${a.id}:${a.kind}`);
    return {
      id: raw.ruleId,
      tool: 'axe',
      code: a.id,
      concept,
      sc: a.sc,
      kind: a.kind,
      confidence: 'automated-certain',
      severity: AXE_IMPACT[a.impact] || 'moderate',
      title: a.help,
      group,
    };
  }
  return ruleById.get(raw.ruleId) || null;
}

/**
 * @param {object[]} raws raw candidates from adapters.collectRaw
 * @param {{journeys?:{name:string,urls:string[],goal?:string}[], versions?:object, scope?:object, now?:string}} ctx
 */
export function buildFindings(raws, ctx = {}) {
  const versions = ctx.versions || {};
  const journeyUrls = new Map();
  for (const j of ctx.journeys || []) for (const u of j.urls || []) journeyUrls.set(normUrl(u), j.name);
  const assumeAllCuj = !(ctx.journeys && ctx.journeys.length);
  const walkComplete = new Set(raws.filter((r) => r.ruleId === '_meta/walk-complete').map((r) => normUrl(r.url)));
  const suppressed = [];
  const errors = raws.filter((r) => r.ruleId === '_meta/adapter-error').map((r) => r.detail);

  /** @type {Map<string, any>} */
  const groups = new Map();
  for (const raw of raws) {
    if (raw.ruleId.startsWith('_meta/')) continue;
    const rule = resolveRule(raw);
    if (!rule || rule.kind === 'info') continue;
    const url = normUrl(raw.url);
    // Contradiction check: a "possible trap" from a Tab pass is dropped when a full tab walk of the same page completed.
    if (rule.concept === 'keyboard-trap' && /REPEAT/.test(rule.code) && walkComplete.has(url)) {
      suppressed.push({ ruleId: rule.id, url, reason: 'tab-walk reached the end of the tab order on this page' });
      continue;
    }
    let confidence = rule.confidence;
    if (raw.toolConfidence === 'low' && confidence === 'needs-review') confidence = 'inferred';
    let severity = rule.severity;
    if (raw.toolConfidence === 'low' && rule.kind === 'failure') severity = sevStep(severity, +1);
    // A simulated persona that got stuck or gave up because of this barrier: it blocks the journey.
    if (raw.tool === 'journeys' && /stuck|gave up/.test(raw.outcome || '') && raw.toolConfidence === 'high' && rule.kind === 'failure')
      severity = 'blocker';
    const onJourney = raw.tool === 'journeys' || (url && journeyUrls.has(url)) || assumeAllCuj;
    const key = rule.group || groupOf(rule);
    if (!groups.has(key))
      groups.set(key, {
        key,
        rules: new Map(),
        locations: new Map(),
        tools: new Set(),
        confidence,
        severity,
        kind: rule.kind,
        concept: rule.concept,
        sc: new Set(),
        onJourney: false,
        helpUrls: new Set(),
        personas: new Set(),
        outcomes: new Set(),
      });
    const g = groups.get(key);
    g.rules.set(rule.id, rule);
    g.tools.add(raw.tool);
    rule.sc.forEach((s) => g.sc.add(s));
    g.severity = sevMax(g.severity, severity);
    if (CONFIDENCES.indexOf(confidence) < CONFIDENCES.indexOf(g.confidence)) g.confidence = confidence;
    g.onJourney ||= onJourney;
    if (raw.helpUrl) g.helpUrls.add(raw.helpUrl.replace(/\?application=\w+$/, ''));
    if (raw.persona) {
      g.personas.add(raw.persona);
      if (raw.outcome) g.outcomes.add(`${raw.persona}: ${raw.outcome}`);
    }
    const lk = `${url || '-'}|${targetKey(raw.target)}`;
    if (!g.locations.has(lk))
      g.locations.set(lk, {
        url: url || null,
        target: raw.target || null,
        widths: new Set(),
        evidence: [],
        screenshots: new Set(),
        journey: url ? journeyUrls.get(url) || null : null,
      });
    const loc = g.locations.get(lk);
    if (raw.width) loc.widths.add(raw.width);
    if (raw.screenshot) loc.screenshots.add(raw.screenshot);
    if (loc.evidence.length < 3 && !loc.evidence.some((e) => e.detail === raw.detail))
      loc.evidence.push({
        tool: raw.tool,
        rule: rule.id,
        detail: raw.detail,
        file: raw.file,
        line: raw.line ?? null,
        ...(raw.axe?.html ? { html: raw.axe.html } : {}),
      });
  }

  const findings = [...groups.values()].map((g) => {
    const rules = [...g.rules.values()];
    const primary = rules.find((r) => r.tool !== 'axe') || rules[0];
    const remedy = REMEDIES[g.concept] || REMEDIES['axe-other'];
    const pages = new Set([...g.locations.values()].map((l) => l.url).filter(Boolean));
    const corroborated = g.tools.size >= 2;
    let rung = remedy.rung;
    if (g.kind === 'failure' && [...g.outcomes].some((o) => /stuck|gave up/.test(o))) rung = 1;
    const effort = remedy.effort;
    const reach = 1 + Math.log2(Math.max(1, pages.size));
    const score =
      g.kind === 'failure'
        ? Math.round(
            (SEV_W[g.severity] *
              CONF_W[g.confidence] *
              reach *
              (g.onJourney ? 1.5 : 1) *
              (corroborated ? 1.2 : 1) *
              ((7 - rung) / 6) *
              10) /
              EFFORT_COST[effort],
          ) / 10
        : 0;
    // Plan (audit skill §5): Fix now = Blocker/Critical in rungs 1-3 on a critical journey.
    // Fix next = other Serious on journeys, rung-4 template issues, Low-effort A/AA journey failures, remaining Blocker/Critical.
    // Inferred (unconfirmed cue) items below Serious wait in Monitor until a human confirms them.
    let plan = 'monitor';
    const high = ['blocker', 'critical'].includes(g.severity);
    if (g.kind === 'failure') {
      if (high && rung <= 3 && g.onJourney && g.confidence !== 'inferred') plan = 'fix-now';
      else if (g.confidence === 'inferred' && !high && g.severity !== 'serious') plan = 'monitor';
      else if (high || (g.severity === 'serious' && g.onJourney) || (rung === 4 && pages.size > 1) || (effort === 'low' && g.onJourney))
        plan = 'fix-next';
    }
    const scs = [...g.sc].sort(cmpSc).map(scRef).filter(Boolean);
    const locations = [...g.locations.values()]
      .sort((a, b) => `${a.url}|${a.target}`.localeCompare(`${b.url}|${b.target}`))
      .map((l) => ({
        url: l.url,
        target: l.target,
        widths: [...l.widths].sort((a, b) => a - b),
        journey: l.journey,
        screenshots: [...l.screenshots].sort(),
        evidence: l.evidence,
        fingerprint: sha(`${g.key}|${l.url}|${targetKey(l.target)}`),
      }));
    const howFound = [...g.tools].sort().map((t) => (HOW_FOUND[t] || (() => `Automated (${t})`))(versions));
    return {
      id: '',
      fingerprint: sha(g.key),
      group: g.key,
      title: titleFor(primary, remedy, g),
      kind: g.kind,
      wcag: scs,
      severity: g.severity,
      confidence: g.confidence,
      corroborated,
      priority: { plan, rung, score, quickWin: g.kind === 'failure' && effort === 'low' && SEVERITIES.indexOf(g.severity) <= 3 },
      effort,
      onCriticalJourney: !!g.onJourney,
      journeyAssumed: assumeAllCuj,
      scope: pages.size > 1 ? 'multi-page' : 'single-page',
      pages: pages.size,
      occurrences: locations.length,
      impact: { who: remedy.who, personas: [...g.personas].sort(), simulatedOutcomes: [...g.outcomes].sort() },
      howFound,
      rules: rules.map((r) => r.id).sort(),
      tools: [...g.tools].sort(),
      locations,
      remediation: {
        concept: g.concept,
        summary: remedy.title,
        steps: remedy.steps,
        before: remedy.before || null,
        after: remedy.after || null,
        platforms: remedy.platforms || {},
        verify: remedy.verify,
        references: [...new Set([...(remedy.refs || []), ...[...g.helpUrls].sort(), ...scs.map((s) => s.url)])],
      },
    };
  });

  const planIdx = (f) => (f.kind === 'failure' ? PLANS.indexOf(f.priority.plan) : 3 + KIND_ORDER.indexOf(f.kind));
  findings.sort(
    (a, b) =>
      planIdx(a) - planIdx(b) ||
      b.priority.score - a.priority.score ||
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.priority.rung - b.priority.rung ||
      a.group.localeCompare(b.group),
  );
  findings.forEach((f, i) => {
    f.id = `F-${String(i + 1).padStart(3, '0')}`;
  });
  return { findings, suppressed, errors };
}

/** Canonical element key so `#zip` (axe) and `input#zip` (forms) count as one place. */
export function targetKey(t) {
  const s = String(t || '')
    .trim()
    .toLowerCase();
  const id = /(?:^|[\s>])[a-z0-9-]*#([\w-]+)$/.exec(s);
  return id ? `#${id[1]}` : s;
}
function cmpSc(a, b) {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
function titleFor(primary, remedy, g) {
  if ((g.concept === 'axe-other' || g.kind !== 'failure') && primary?.title) return primary.title;
  return remedy.title && (g.rules.size > 1 || primary?.tool === 'axe') ? remedy.title : primary?.title || remedy.title;
}

export function summarize(findings, suppressed = []) {
  const count = (pred) => findings.filter(pred).length;
  const by = (field, values, pred = () => true) =>
    Object.fromEntries(values.map((v) => [v, count((f) => pred(f) && (field === 'plan' ? f.priority.plan : f[field]) === v)]));
  const fail = (f) => f.kind === 'failure';
  const pages = new Set(findings.flatMap((f) => f.locations.map((l) => l.url)).filter(Boolean));
  return {
    total: findings.length,
    failures: count(fail),
    failuresConfirmedByRules: count((f) => fail(f) && f.confidence === 'automated-certain'),
    byKind: Object.fromEntries(KIND_ORDER.map((k) => [k, count((f) => f.kind === k)])),
    bySeverity: by('severity', SEVERITIES, fail),
    byConfidence: by('confidence', CONFIDENCES, fail),
    byPlan: by('plan', PLANS, fail),
    quickWins: count((f) => f.priority.quickWin),
    pagesWithFindings: pages.size,
    suppressedCandidates: suppressed.length,
  };
}
