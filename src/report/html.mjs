// Accessible HTML report (no JavaScript): lang, skip link, landmarks, one h1, heading outline, captioned tables
// with th scope, text labels (never colour alone), visible focus, 4.5:1+ colours, reflows at 320 px, print styles.
import path from 'node:path';
import { executiveSummary, keyScreenshot, methodsSentence, notTestedFor, realSrRows, shortUrl } from './guidance.mjs';
import { PLAN_LABEL, CONF_LABEL, KIND_LABEL, PLATFORM_LABEL, rel, platformOrder } from './markdown.mjs';

const e = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const CSS = `:root{color-scheme:light;--fg:#1b1b1b;--muted:#4a4a4a;--bg:#fff;--line:#c8c8c8;--link:#0b57d0;--focus:#b3261e}
*{box-sizing:border-box}a,code,td,dd,li,p{overflow-wrap:anywhere}body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg)}
a{color:var(--link)}a:focus-visible,summary:focus-visible,.tbl:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.skip{position:absolute;left:-9999px}.skip:focus{left:1rem;top:1rem;background:#fff;padding:.5rem 1rem;z-index:9}
header,main,footer{max-width:62rem;margin:0 auto;padding:1rem}header{border-bottom:2px solid var(--line)}
.note{color:var(--muted)}figure{margin:1rem 0}figure img{max-width:100%;max-height:28rem;height:auto;border:1px solid var(--line)}figcaption{font-size:.9rem;color:var(--muted)}.warn{border:2px solid #8a4b00;background:#fff4e5;color:#1b1b1b;padding:.5rem 1rem}nav ol{columns:2;padding-left:1.2rem}@media(max-width:40rem){nav ol{columns:1}}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.95rem}caption{text-align:left;font-weight:600;padding:.25rem 0}
th,td{border:1px solid var(--line);padding:.4rem .5rem;text-align:left;vertical-align:top}th{background:#f2f2f2}
.tbl{overflow-x:auto}.card{border:1px solid var(--line);border-left:6px solid #5f5f5f;border-radius:4px;padding:.5rem 1rem;margin:1.25rem 0}
.card.sev-blocker,.card.sev-critical{border-left-color:#8c1d18}.card.sev-serious{border-left-color:#7a4f01}
.tag{display:inline-block;border:1px solid #5f5f5f;border-radius:3px;padding:0 .35rem;margin:0 .25rem .25rem 0;font-size:.85rem}
pre{background:#f6f6f6;border:1px solid var(--line);padding:.5rem;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}blockquote{margin:1rem 0;padding:.5rem 1rem;border-left:4px solid var(--line)}
ul.check{list-style:none;padding-left:0}ul.check li::before{content:"☐ ";font-weight:700}
@media print{.skip,nav{display:none}.card{break-inside:avoid}a{color:#000}}`;
// Extra print rules for the PDF deliverable (page.pdf): cover page, compact type, no split rows/figures.
const PDF_CSS = `body{font-size:10.5pt;line-height:1.45}header,main,footer{max-width:none;padding:0}
.cover{min-height:240mm;display:flex;flex-direction:column;justify-content:center;break-after:page;border-bottom:none}
.cover .kicker{font-size:11pt;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0}
.cover h1{font-size:26pt;line-height:1.15;margin:.3em 0 .6em}.cover dl{display:grid;grid-template-columns:9em 1fr;gap:.35em 1em;margin:0 0 1.5em}
.cover dt{font-weight:600}.cover dd{margin:0}.cover .note{border-top:2px solid var(--line);padding-top:.75em}
h2{break-after:avoid;border-bottom:2px solid var(--line);padding-bottom:.15em;margin-top:1.4em}h3{break-after:avoid}
section#summary-sec{break-after:page}tr,figure,.top-shot{break-inside:avoid}thead{display:table-header-group}
.tbl{overflow:visible}figure img{max-height:9cm}.card{break-inside:auto}.card>h3{break-after:avoid}
pre{white-space:pre-wrap;font-size:8.5pt;max-height:none}details>summary{list-style:none;font-weight:600}
.top-shot{margin:.5em 0 1em}.top-shot img{max-height:6.5cm}
table{font-size:9pt}th,td{padding:.3em .4em}tbody th[scope=row],tbody th[scope=row] a{white-space:nowrap}`;

export function renderHtml(doc, { outDir = '.', platform = null, maxLocations = 8, pdf = false } = {}) {
  const site = doc.run.pages[0] ? new URL(doc.run.pages[0]).host : 'site';
  const date = (doc.run.finishedAt || doc.run.startedAt || '').slice(0, 10);
  const failures = doc.findings.filter((f) => f.kind === 'failure');
  const others = doc.findings.filter((f) => f.kind !== 'failure' && f.kind !== 'not-tested');
  const notTested = doc.findings.filter((f) => f.kind === 'not-tested');
  const ex = executiveSummary(doc);
  const H = [];
  H.push(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accessibility audit report: ${e(site)} (${e(date)})</title><style>${CSS}${pdf ? PDF_CSS : ''}</style></head><body>`,
  );
  H.push('<a class="skip" href="#main">Skip to report</a>');
  if (pdf) H.push(cover(doc, { site, date, failures }));
  else
    H.push(
      `<header><h1>Accessibility audit report: ${e(site)}</h1><p>${e(date)} · WCAG 2.2 AA · ${doc.run.pages.length} page(s) · ada-audit-scripts ${e(doc.generator.version || '')}</p><p class="note">Every finding is a candidate: confirm it in the DOM and on a screenshot before reporting it. Not legal advice. Not a conformance claim.</p>`,
    );
  if (!pdf)
    H.push(
      '<nav aria-label="Contents"><h2>Contents</h2><ol><li><a href="#summary">Executive summary</a></li><li><a href="#plan">Fix plan</a></li><li><a href="#table">Findings at a glance</a></li><li><a href="#details">Findings and how to fix them</a></li>' +
        (doc.journeys?.length ? '<li><a href="#journeys">Simulated persona journeys</a></li>' : '') +
        '<li><a href="#other">Best practices and advisories</a></li><li><a href="#manual">Not tested and manual checks</a></li><li><a href="#scope">Scope, methods and statement</a></li></ol></nav></header>',
    );
  H.push('<main id="main">');
  H.push(
    `<section aria-labelledby="summary"${pdf ? ' id="summary-sec"' : ''}><h2 id="summary">1. Executive summary</h2>${ex.lead.map((p) => `<p>${e(p)}</p>`).join('')}`,
  );
  if (doc.errors.length)
    H.push(
      `<p class="warn" role="note"><strong>Incomplete run:</strong> ${doc.errors.length} tool problem(s), listed under Tool notes. Checks from those tools are missing, so absence of a finding there means nothing.</p>`,
    );
  if (ex.top.length)
    H.push(
      `<h3>Top barriers</h3><ol>${ex.top
        .map(
          (t, i) =>
            `<li><a href="#${t.id}"><strong>${t.id} ${e(t.title)}</strong></a>. ${e(t.who)} It ${e(t.effect)}. <em>${PLAN_LABEL[t.plan]} · effort ${t.effort} · WCAG ${e(t.sc || '—')}${t.pages > 1 ? ` · ${t.pages} pages` : ''}${t.confidence !== 'automated-certain' ? ' · confirm first' : ''}</em>${
              pdf && i < 3
                ? topShot(
                    failures.find((f) => f.id === t.id),
                    outDir,
                  )
                : ''
            }</li>`,
        )
        .join('')}</ol>`,
    );
  if (doc.journeysAssumed)
    H.push('<p class="note">Critical journeys were not named, so every audited page is treated as part of a critical journey.</p>');
  H.push('</section>');

  H.push('<section aria-labelledby="plan"><h2 id="plan">2. Fix plan</h2>');
  const quick = failures.filter((f) => f.priority.quickWin).slice(0, 8);
  if (quick.length)
    H.push(
      `<h3>Quick wins (under an hour each, real impact)</h3><ul class="check">${quick.map((f) => `<li><a href="#${f.id}">${f.id}</a> ${e(f.title)} · WCAG ${e(f.wcag.map((w) => w.sc).join(', '))}${f.pages > 1 ? ' · fix the shared template once' : ''}</li>`).join('')}</ul>`,
    );
  for (const plan of ['fix-now', 'fix-next', 'monitor']) {
    const list = failures.filter((f) => f.priority.plan === plan);
    H.push(
      `<h3>${PLAN_LABEL[plan]} (${list.length})</h3>` +
        (list.length
          ? `<ul class="check">${list.map((f) => `<li><a href="#${f.id}">${f.id}</a> ${e(f.title)} · ${f.severity} · effort ${f.effort} · ${f.occurrences} place(s) on ${f.pages} page(s)${f.confidence !== 'automated-certain' ? ' · confirm first' : ''}</li>`).join('')}</ul>`
          : '<p class="note">Nothing in this group.</p>'),
    );
  }
  H.push(
    '<p class="note">Order inside each group: impact × confidence × reach ÷ effort. Fix shared templates and components before single pages.</p></section>',
  );

  H.push(
    '<section aria-labelledby="table"><h2 id="table">3. Findings at a glance</h2><div class="tbl" tabindex="0" role="region" aria-label="TBL_LABEL"><table><caption>Candidate WCAG 2.2 A/AA failures, in fix order</caption><thead><tr>' +
      ['ID', 'Issue', 'WCAG (level)', 'Severity', 'Confidence', 'Effort', 'Plan', 'Pages']
        .map((h) => `<th scope="col">${h}</th>`)
        .join('') +
      '</tr></thead><tbody>',
  );
  failures.forEach((f) =>
    H.push(
      `<tr><th scope="row"><a href="#${f.id}">${f.id}</a></th><td>${e(f.title)}</td><td>${e(f.wcag.map((w) => `${w.sc} (${w.level})`).join(', '))}</td><td>${cap(f.severity)}</td><td>${CONF_LABEL[f.confidence]}</td><td>${cap(f.effort)}</td><td>${PLAN_LABEL[f.priority.plan]}</td><td>${f.pages}</td></tr>`,
    ),
  );
  if (!failures.length) H.push('<tr><td colspan="8">No candidate failures.</td></tr>');
  H.push('</tbody></table></div></section>');

  H.push('<section aria-labelledby="details"><h2 id="details">4. Findings and how to fix them</h2>');
  for (const f of failures) H.push(card(f, { outDir, platform, maxLocations }));
  H.push('</section>');

  if (doc.journeys?.length) {
    H.push(
      '<section aria-labelledby="journeys"><h2 id="journeys">5. Simulated persona journeys</h2><p class="note">Scripted models of how some disabled people browse. Not real users and not assistive technology.</p><div class="tbl" tabindex="0" role="region" aria-label="TBL_LABEL"><table><caption>Persona outcomes per start page</caption><thead><tr><th scope="col">Page</th><th scope="col">Persona</th><th scope="col">Outcome</th><th scope="col">Steps</th><th scope="col">Friction</th></tr></thead><tbody>',
    );
    doc.journeys.forEach((j) =>
      H.push(
        `<tr><td>${e(shortUrl(j.url))}</td><td>${e(j.personaLabel)}</td><td>${e(j.outcome)}</td><td>${j.steps ?? ''}</td><td>${e(j.friction ?? '—')}</td></tr>`,
      ),
    );
    H.push('</tbody></table></div></section>');
  }
  const sr = realSrRows(doc);
  if (sr.length) {
    H.push(
      '<section aria-labelledby="realsr"><h2 id="realsr">5a. Real screen-reader runs</h2><p class="note">NVDA or VoiceOver driven by Guidepup: real speech output from scripted navigation (quick-nav and Tab). Not a human listener, and nothing was submitted. Failed passes are missing, not clean.</p><div class="tbl" tabindex="0" role="region" aria-label="TBL_LABEL"><table><caption>Real screen-reader transcripts</caption><thead><tr><th scope="col">Screen reader + browser</th><th scope="col">Page</th><th scope="col">Passes (steps)</th><th scope="col">Ran fully</th><th scope="col">Transcript</th></tr></thead><tbody>',
    );
    sr.forEach((r) =>
      H.push(
        `<tr><td>${e(r.who)}</td><td>${e(shortUrl(r.url))}</td><td>${e(r.passes)}</td><td>${r.ok ? 'yes' : '<strong>no</strong>'}</td><td><a href="${e(r.transcript.split(String.fromCharCode(92)).join('/'))}">${e(r.transcript)}</a></td></tr>`,
      ),
    );
    H.push('</tbody></table></div></section>');
  }
  H.push(
    '<section aria-labelledby="other"><h2 id="other">6. Best practices, AAA and advisories</h2><p>These are not WCAG 2.2 AA failures.</p>',
  );
  if (others.length) {
    H.push(
      '<div class="tbl" tabindex="0" role="region" aria-label="TBL_LABEL"><table><caption>Non-failure items</caption><thead><tr><th scope="col">ID</th><th scope="col">Item</th><th scope="col">Type</th><th scope="col">Pages</th><th scope="col">Suggested fix</th></tr></thead><tbody>',
    );
    others.forEach((f) =>
      H.push(
        `<tr><th scope="row">${f.id}</th><td>${e(f.title)}</td><td>${KIND_LABEL[f.kind]}</td><td>${f.pages}</td><td>${e(f.remediation.steps[0])}</td></tr>`,
      ),
    );
    H.push('</tbody></table></div>');
  } else H.push('<p>None.</p>');
  H.push('</section>');

  H.push(
    '<section aria-labelledby="manual"><h2 id="manual">7. Not tested, and the manual checks still needed</h2><h3>Not tested in this run</h3><ul>',
  );
  notTested.forEach((f) =>
    H.push(
      `<li>${e(f.title)}: ${e(
        f.locations
          .map((l) => shortUrl(l.url) + (l.target ? ' ' + l.target : ''))
          .slice(0, 4)
          .join(', '),
      )}. ${e(f.remediation.steps[0])}</li>`,
    ),
  );
  notTestedFor(doc.run).forEach((t) => H.push(`<li>${e(t)}</li>`));
  H.push('</ul><h3>Manual testing checklist</h3><ul class="check">');
  doc.manualChecklist.forEach((m) =>
    H.push(`<li>${m.priority ? '<strong>Priority:</strong> ' : ''}${e(m.check)} <span class="note">(WCAG ${e(m.sc)})</span></li>`),
  );
  H.push('</ul></section>');

  H.push(
    `<section aria-labelledby="scope"><h2 id="scope">8. Scope, methods and statement</h2><dl><dt>Date</dt><dd>${e(date)}</dd><dt>Target</dt><dd>WCAG 2.2 Level AA</dd><dt>Pages (${doc.run.pages.length})</dt><dd><ul>${doc.run.pages.map((p) => `<li><a href="${e(p)}">${e(p)}</a></li>`).join('')}</ul></dd><dt>Methods</dt><dd>${e(methodsSentence(doc.run))}</dd><dt>Tools</dt><dd>${e(
      Object.entries(doc.run.versions || {})
        .map(([k, v]) => `${k} ${v}`)
        .join(', '),
    )}</dd></dl>`,
  );
  H.push(
    `<h3>Evaluation statement</h3><p>Use this wording; never write "compliant" or "conformant".</p><blockquote><p>${e(doc.conformance.statement)}</p></blockquote>`,
  );
  if (doc.suppressed.length || doc.errors.length) {
    H.push('<h3>Tool notes</h3><ul>');
    if (doc.suppressed.length)
      H.push(`<li>${doc.suppressed.length} candidate(s) dropped after a cross-check; listed in findings.json.</li>`);
    for (const x of doc.errors) H.push(`<li>${e(x)}</li>`);
    H.push('</ul>');
  }
  H.push(
    '</section></main><footer><p class="note">Generated by <a href="https://github.com/eedgarivann/ada-audit-scripts">ada-audit-scripts</a>. General information, not legal advice.</p></footer></body></html>',
  );
  // Each scrollable table region is named after its caption (unique landmarks; keyboard-scrollable at 320 px).
  let out = H.join('\n');
  // PDF: images load eagerly and collapsed platform hints print expanded.
  if (pdf) out = out.replace(/ loading="lazy"/g, '').replace(/<details>/g, '<details open>');
  return (
    out.replace(
      /aria-label="TBL_LABEL"><table><caption>([^<]*)<\/caption>/g,
      (_, c) => `aria-label="${c} (scrollable)"><table><caption>${c}</caption>`,
    ) + '\n'
  );
}

function card(f, { outDir, platform, maxLocations }) {
  const H = [`<article class="card sev-${f.severity}" aria-labelledby="${f.id}"><h3 id="${f.id}">${f.id} ${e(f.title)}</h3>`];
  H.push(
    `<p><span class="tag">Severity: ${cap(f.severity)}</span><span class="tag">${CONF_LABEL[f.confidence]}</span>${f.corroborated ? `<span class="tag">Found by ${f.tools.length} tools</span>` : ''}<span class="tag">${PLAN_LABEL[f.priority.plan]}</span><span class="tag">Effort: ${cap(f.effort)}</span></p>`,
  );
  H.push(
    `<p><strong>What's wrong:</strong> ${e(f.remediation.summary)}. Seen in ${f.occurrences} place(s) on ${f.pages} page(s).${f.pages > 1 ? ' The same problem on several pages usually means a shared template or component: fix it once there.' : ''}</p>`,
  );
  H.push(
    `<p><strong>Who it hurts:</strong> ${e(f.impact.who)}${f.impact.simulatedOutcomes.length ? ` Simulated: ${e(f.impact.simulatedOutcomes.join(', '))}.` : ''}</p>`,
  );
  H.push(
    `<p><strong>WCAG:</strong> ${f.wcag.map((w) => `<a href="${e(w.url)}">${w.sc} ${e(w.name)}</a> (${w.level})`).join('; ') || '—'}</p><p><strong>How found:</strong> ${e(f.howFound.join('; '))}</p>`,
  );
  H.push(
    '<p><strong>Where:</strong></p><ul>' +
      f.locations
        .slice(0, maxLocations)
        .map(
          (l) =>
            `<li>${l.url ? `<a href="${e(l.url)}">${e(shortUrl(l.url))}</a>` : 'site-wide'}${l.target ? ` · <code>${e(l.target)}</code>` : ''}${l.widths.length ? ` · ${l.widths.join('/')} px` : ''}${
              l.screenshots.length
                ? ' · ' +
                  l.screenshots
                    .slice(0, 2)
                    .map((s) => `<a href="${e(rel(outDir, s))}">screenshot ${e(path.basename(s))}</a>`)
                    .join(', ')
                : ''
            }</li>`,
        )
        .join('') +
      (f.locations.length > maxLocations ? `<li>…and ${f.locations.length - maxLocations} more (see findings.json)</li>` : '') +
      '</ul>',
  );
  const shot = keyScreenshot(f);
  if (shot)
    H.push(
      `<figure><img src="${e(rel(outDir, shot.file))}" alt="${e(shot.alt)}" loading="lazy"><figcaption>${e(shot.caption)}</figcaption></figure>`,
    );
  const ev = f.locations[0]?.evidence?.[0];
  if (ev)
    H.push(`<p><strong>Evidence (first location):</strong></p><pre><code>${e((ev.html ? ev.html + '\n' : '') + ev.detail)}</code></pre>`);
  H.push('<p><strong>How to fix:</strong></p><ol>' + f.remediation.steps.map((s) => `<li>${e(s)}</li>`).join('') + '</ol>');
  if (f.remediation.before) H.push(`<p>Before:</p><pre><code>${e(f.remediation.before)}</code></pre>`);
  if (f.remediation.after) H.push(`<p>After:</p><pre><code>${e(f.remediation.after)}</code></pre>`);
  const plats = platformOrder(platform).filter((p) => f.remediation.platforms[p]);
  if (plats.length) {
    const first = platform && f.remediation.platforms[platform] ? [platform] : [];
    const rest = plats.filter((p) => !first.includes(p));
    H.push(
      '<p><strong>Where to change it</strong> (typical location; menus differ by theme, app and version; <a href="https://github.com/eedgarivann/ada-audit-scripts/blob/main/docs/platform-hints.md">sources</a>):</p>' +
        (first.length ? `<p>${PLATFORM_LABEL[first[0]]}: ${e(f.remediation.platforms[first[0]])}</p>` : '') +
        (rest.length
          ? `<details><summary>${first.length ? 'Other platforms' : 'Platform hints'}</summary><ul>${rest.map((p) => `<li>${PLATFORM_LABEL[p]}: ${e(f.remediation.platforms[p])}</li>`).join('')}</ul></details>`
          : ''),
    );
  }
  H.push(`<p><strong>How to verify:</strong> ${e(f.remediation.verify)}</p>`);
  if (f.remediation.references.length)
    H.push(
      '<p><strong>References:</strong> ' +
        f.remediation.references
          .slice(0, 4)
          .map((r) => `<a href="${e(r)}">${e(r.replace(/^https?:\/\//, '').slice(0, 70))}</a>`)
          .join(' · ') +
        '</p>',
    );
  H.push('</article>');
  return H.join('\n');
}

// PDF cover: what was audited, when, how, and what the report is not.
function cover(doc, { site, date, failures }) {
  const pages = doc.run.pages;
  const s = doc.summary;
  const list =
    pages
      .slice(0, 6)
      .map((p) => e(shortUrl(p) || p))
      .join('<br>') + (pages.length > 6 ? `<br>…and ${pages.length - 6} more (section 8)` : '');
  return `<header class="cover"><p class="kicker">Accessibility audit report</p><h1>${e(site)}</h1><dl><dt>Date</dt><dd>${e(date)}</dd><dt>Standard</dt><dd>WCAG 2.2 Level AA (candidate failures)</dd><dt>Scope</dt><dd>${pages.length} page(s)${doc.journeysAssumed ? '' : ', critical journeys named'}<br>${list}</dd><dt>Result</dt><dd>${failures.length} candidate failure(s): ${s.byPlan['fix-now']} fix now, ${s.byPlan['fix-next']} fix next, ${s.byPlan.monitor} monitor</dd><dt>Methods</dt><dd>${e(methodsSentence(doc.run))}</dd><dt>Generated by</dt><dd>ada-audit-scripts ${e(doc.generator.version || '')}</dd></dl><p class="note">Every finding is a candidate to confirm on the live page. Automated and simulated checks cover only part of WCAG; manual checks are listed in section 7. Not legal advice. Not a certification or conformance claim.</p></header>`;
}

function topShot(f, outDir) {
  const shot = f && keyScreenshot(f);
  return shot
    ? `<figure class="top-shot"><img src="${e(rel(outDir, shot.file))}" alt="${e(shot.alt)}"><figcaption>${e(shot.caption)}</figcaption></figure>`
    : '';
}
