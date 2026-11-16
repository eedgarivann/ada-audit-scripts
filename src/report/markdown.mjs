// Markdown report: executive summary -> fix plan -> table -> per-finding cards -> journeys -> non-failures -> manual checklist -> scope.
import path from 'node:path';
import { executiveSummary, keyScreenshot, methodsSentence, NOT_TESTED, shortUrl } from './guidance.mjs';

export const PLAN_LABEL = { 'fix-now': 'Fix now', 'fix-next': 'Fix next', monitor: 'Monitor' };
export const CONF_LABEL = {
  'automated-certain': 'Automated: certain',
  'needs-review': 'Needs human review',
  inferred: 'Inferred (unconfirmed cue)',
};
export const KIND_LABEL = {
  failure: 'WCAG A/AA failure (candidate)',
  'best-practice': 'Best practice (not a failure)',
  aaa: 'AAA (not required for AA)',
  advisory: 'Advisory',
  'not-tested': 'Not tested',
  'other-risk': 'Other risk (not accessibility)',
};
export const PLATFORM_LABEL = {
  wordpress: 'WordPress',
  shopify: 'Shopify',
  webflow: 'Webflow',
  framer: 'Framer',
  squarespace: 'Squarespace',
  wix: 'Wix',
  react: 'React / custom code',
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
export function rel(outDir, p) {
  return p ? path.relative(outDir, p).split(path.sep).join('/') : null;
}
export function platformOrder(platform) {
  const all = Object.keys(PLATFORM_LABEL);
  return platform && all.includes(platform) ? [platform, ...all.filter((p) => p !== platform)] : all;
}

export function renderMarkdown(doc, { outDir = '.', platform = null, maxLocations = 8 } = {}) {
  const L = [];
  const site = doc.run.pages[0] ? new URL(doc.run.pages[0]).host : 'site';
  const date = (doc.run.finishedAt || doc.run.startedAt || '').slice(0, 10);
  const failures = doc.findings.filter((f) => f.kind === 'failure');
  const others = doc.findings.filter((f) => f.kind !== 'failure' && f.kind !== 'not-tested');
  const notTested = doc.findings.filter((f) => f.kind === 'not-tested');
  L.push(`# Accessibility audit report: ${site}`, '');
  L.push(
    `> ${date} · WCAG 2.2 AA · ${doc.run.pages.length} page(s) · ada-audit-scripts ${doc.generator.version || ''}  `,
    '> Every finding is a candidate: confirm it in the DOM and on a screenshot before reporting it. Not legal advice. Not a conformance claim.',
    '',
  );

  const ex = executiveSummary(doc);
  L.push('## 1. Executive summary', '', ...ex.lead, '');
  if (doc.errors.length)
    L.push(
      `> **Incomplete run:** ${doc.errors.length} tool problem(s) (see "Tool notes" at the end). Checks from those tools are missing, so absence of a finding there means nothing.`,
      '',
    );
  if (ex.top.length) {
    L.push('**Top barriers**', '');
    ex.top.forEach((t, i) =>
      L.push(
        `${i + 1}. **${t.id} ${t.title}** — ${t.who} It ${t.effect}. *${PLAN_LABEL[t.plan]} · effort ${t.effort} · WCAG ${t.sc || '—'}${t.pages > 1 ? ` · ${t.pages} pages` : ''}${t.confidence !== 'automated-certain' ? ' · confirm first' : ''}*`,
      ),
    );
    L.push('');
  }
  if (doc.journeysAssumed)
    L.push(
      '_Critical journeys were not named, so every audited page is treated as part of a critical journey. Pass `--journey` or a config file to sharpen priorities._',
      '',
    );

  L.push('## 2. Fix plan', '');
  const quick = failures.filter((f) => f.priority.quickWin).slice(0, 8);
  if (quick.length) {
    L.push('### Quick wins (under an hour each, real impact)', '');
    quick.forEach((f) =>
      L.push(
        `- [ ] **${f.id}** ${f.title} · WCAG ${f.wcag.map((w) => w.sc).join(', ')}${f.pages > 1 ? ' · fix the shared template once' : ''}`,
      ),
    );
    L.push('');
  }
  for (const plan of ['fix-now', 'fix-next', 'monitor']) {
    const list = failures.filter((f) => f.priority.plan === plan);
    L.push(`### ${PLAN_LABEL[plan]} (${list.length})`, '');
    if (!list.length) L.push('_Nothing in this group._');
    list.forEach((f) =>
      L.push(
        `- [ ] **${f.id}** ${f.title} · WCAG ${f.wcag.map((w) => w.sc).join(', ') || '—'} · ${f.severity} · effort ${f.effort} · ${f.occurrences} place(s) on ${f.pages} page(s)${f.confidence !== 'automated-certain' ? ' · confirm first' : ''}`,
      ),
    );
    L.push('');
  }
  L.push('Order inside each group: impact × confidence × reach ÷ effort. Fix shared templates and components before single pages.', '');

  L.push(
    '## 3. Findings at a glance',
    '',
    '| ID | Issue | WCAG (level) | Severity | Confidence | Effort | Plan | Pages |',
    '|---|---|---|---|---|---|---|---|',
  );
  failures.forEach((f) =>
    L.push(
      `| ${f.id} | ${esc(f.title)} | ${esc(f.wcag.map((w) => `${w.sc} (${w.level})`).join(', '))} | ${cap(f.severity)} | ${CONF_LABEL[f.confidence]} | ${cap(f.effort)} | ${PLAN_LABEL[f.priority.plan]} | ${f.pages} |`,
    ),
  );
  if (!failures.length) L.push('| — | No candidate failures | | | | | | |');
  L.push('');

  L.push('## 4. Findings and how to fix them', '');
  for (const f of failures) L.push(...card(f, { outDir, platform, maxLocations }));

  if (doc.journeys?.length) {
    L.push(
      '## 5. Simulated persona journeys',
      '',
      '_Scripted models of how some disabled people browse. Not real users and not assistive technology: a "reached" result is not proof, a "gave up" result needs a human check._',
      '',
      '| Page | Persona | Outcome | Steps | Friction |',
      '|---|---|---|---|---|',
    );
    doc.journeys.forEach((j) =>
      L.push(`| ${esc(shortUrl(j.url))} | ${j.personaLabel} | ${j.outcome} | ${j.steps ?? ''} | ${j.friction ?? '—'} |`),
    );
    L.push('');
  }
  L.push('## 6. Best practices, AAA and advisories (not WCAG AA failures)', '');
  if (others.length) {
    L.push('| ID | Item | Type | Pages | Suggested fix |', '|---|---|---|---|---|');
    others.forEach((f) => L.push(`| ${f.id} | ${esc(f.title)} | ${KIND_LABEL[f.kind]} | ${f.pages} | ${esc(f.remediation.steps[0])} |`));
  } else L.push('_None._');
  L.push('');

  L.push('## 7. Not tested, and the manual checks still needed', '', '**Not tested in this run**', '');
  notTested.forEach((f) =>
    L.push(
      `- ${f.title} — ${f.locations
        .map((l) => shortUrl(l.url) + (l.target ? ' ' + l.target : ''))
        .slice(0, 4)
        .join(', ')}. ${f.remediation.steps[0]}`,
    ),
  );
  NOT_TESTED.forEach((t) => L.push(`- ${t}`));
  L.push('', '**Manual testing checklist** (automation cannot judge these)', '');
  doc.manualChecklist.forEach((m) => L.push(`- [ ] ${m.priority ? '**Priority:** ' : ''}${m.check} _(WCAG ${m.sc})_`));
  L.push('');

  L.push('## 8. Scope, methods and statement', '');
  L.push(
    `- **Date:** ${date}`,
    `- **Target:** WCAG 2.2 Level AA`,
    `- **Pages (${doc.run.pages.length}):** ${doc.run.pages.map((p) => `<${p}>`).join(', ')}`,
    `- **Methods:** ${methodsSentence(doc.run)}`,
    `- **Tools:** ${Object.entries(doc.run.versions || {})
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
  if (doc.criticalJourneys?.length)
    L.push(`- **Critical journeys:** ${doc.criticalJourneys.map((j) => `${j.name}${j.goal ? ` (${j.goal})` : ''}`).join('; ')}`);
  L.push(
    '',
    '**Evaluation statement** (use this wording; never write "compliant" or "conformant"):',
    '',
    `> ${doc.conformance.statement}`,
    '',
  );
  if (doc.suppressed.length || doc.errors.length) {
    L.push('## 9. Tool notes', '');
    if (doc.suppressed.length)
      L.push(
        `- ${doc.suppressed.length} candidate(s) dropped after a cross-check (e.g. a "possible trap" on a page where the full Tab walk completed). Listed in findings.json \`suppressed\`.`,
      );
    doc.errors.forEach((e) => L.push(`- ${e}`));
    L.push('');
  }
  L.push(
    '---',
    'Generated by [ada-audit-scripts](https://github.com/eedgarivann/ada-audit-scripts). Findings are candidates; this is general information, not legal advice.',
  );
  return L.join('\n') + '\n';
}

function card(f, { outDir, platform, maxLocations }) {
  const L = [`### ${f.id} ${f.title}`, ''];
  const sev = `${cap(f.severity)} · ${CONF_LABEL[f.confidence]}${f.corroborated ? ' · found by ' + f.tools.length + ' tools' : ''} · ${PLAN_LABEL[f.priority.plan]} · effort ${f.effort}`;
  L.push(`**${sev}**`, '');
  L.push(
    `- **What's wrong:** ${f.remediation.summary}. Seen in ${f.occurrences} place(s) on ${f.pages} page(s).${f.pages > 1 ? ' The same problem on several pages usually means a shared template or component: fix it once there.' : ''}`,
  );
  L.push(
    `- **Who it hurts:** ${f.impact.who}${f.impact.simulatedOutcomes.length ? ` Simulated: ${f.impact.simulatedOutcomes.join(', ')}.` : ''}`,
  );
  L.push(`- **WCAG:** ${f.wcag.map((w) => `[${w.sc} ${w.name}](${w.url}) (${w.level})`).join('; ') || '—'}`);
  L.push(`- **How found:** ${f.howFound.join('; ')}`);
  L.push('- **Where:**');
  f.locations.slice(0, maxLocations).forEach((l) =>
    L.push(
      `  - ${l.url ? `<${l.url}>` : '(site-wide)'}${l.target ? ` · \`${l.target.replace(/`/g, "'")}\`` : ''}${l.widths.length ? ` · ${l.widths.join('/')} px` : ''}${
        l.screenshots.length
          ? ` · screenshot: ${l.screenshots
              .slice(0, 2)
              .map((s) => `[${path.basename(s)}](${rel(outDir, s)})`)
              .join(', ')}`
          : ''
      }`,
    ),
  );
  if (f.locations.length > maxLocations) L.push(`  - …and ${f.locations.length - maxLocations} more (see findings.json)`);
  const shot = keyScreenshot(f);
  if (shot) L.push('', `  ![${shot.alt.replace(/[[\]]/g, '')}](${rel(outDir, shot.file)})`, `  <br>*${shot.caption}*`, '');
  const ev = f.locations[0]?.evidence?.[0];
  if (ev)
    L.push(
      '- **Evidence (first location):**',
      '',
      '  ```text',
      `  ${(ev.html ? ev.html + '\n  ' : '') + ev.detail.replace(/\n/g, ' ')}`,
      '  ```',
      '',
    );
  L.push('- **How to fix:**');
  f.remediation.steps.forEach((s, i) => L.push(`  ${i + 1}. ${s}`));
  if (f.remediation.before || f.remediation.after) {
    if (f.remediation.before) L.push('', '  Before:', '', '  ```html', ...f.remediation.before.split('\n').map((x) => '  ' + x), '  ```');
    if (f.remediation.after) L.push('', '  After:', '', '  ```html', ...f.remediation.after.split('\n').map((x) => '  ' + x), '  ```');
    L.push('');
  }
  const plats = platformOrder(platform).filter((p) => f.remediation.platforms[p]);
  if (plats.length) {
    L.push(
      '- **Where to change it** (typical location; menus differ by theme, app and version; [sources](https://github.com/eedgarivann/ada-audit-scripts/blob/main/docs/platform-hints.md)):',
    );
    (platform && f.remediation.platforms[platform] ? [platform] : plats).forEach((p) =>
      L.push(`  - ${PLATFORM_LABEL[p]}: ${f.remediation.platforms[p]}`),
    );
  }
  L.push(`- **How to verify:** ${f.remediation.verify}`);
  if (f.remediation.references.length)
    L.push(
      `- **References:** ${f.remediation.references
        .slice(0, 4)
        .map((r) => `<${r}>`)
        .join(' · ')}`,
    );
  L.push('');
  return L;
}
