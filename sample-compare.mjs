// sample-compare: checks that need several pages (WCAG-EM: sample >= 3 pages of one site).
// 2.4.2 page titles (DUP-TITLE, GENERIC-TITLE), 3.2.3 consistent navigation (NAV-ORDER-DIFFERS),
// 3.2.4 consistent identification (UNNAMED-REPEATED, INCONSISTENT-NAME), 3.2.6 consistent help (HELP-ORDER-DIFFERS?),
// 3.3.7 cue (REPEATED-FIELD? across steps). Read-only (safePage). Outputs are candidates.
import fs from 'node:fs'; import path from 'node:path';
import { parseArgs, readUrls, safePage, open, outDir, header } from './lib.mjs';
const args = parseArgs(); const urls = readUrls(args);
if (urls.length < 2) { console.error('usage: node sample-compare.mjs --urls a,b,c (>=2, ideally >=3 pages of one site) [--title-strip "regex"] [--width 1440] [--process]'); process.exit(1); }
const width = Number(args.width || 1440); const strip = args['title-strip'] ? new RegExp(args['title-strip']) : null;
const dir = outDir(args, 'sample-compare');
const { browser, page } = await safePage(args, { width, height: 900 });
const data = [];
for (const url of urls) {
  await open(page, url);
  data.push({ url, ...(await page.evaluate(() => {
    const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const nm = e => { const l = e.getAttribute('aria-labelledby'); if (l) return l.split(/\s+/).map(i => document.getElementById(i)?.innerText || '').join(' ').trim(); return (e.getAttribute('aria-label') || (e.labels?.[0]?.textContent || '').trim() || e.innerText || [...e.querySelectorAll('img')].map(i => i.getAttribute('alt') || '').join(' ') || e.getAttribute('title') || e.value || '').trim().replace(/\s+/g, ' '); };
    const norm = h => { try { const u = new URL(h, location.href); return u.origin + u.pathname.replace(/\/index\.html?$/, '/'); } catch { return h; } };
    const h1 = [...document.querySelectorAll('h1,[role=heading][aria-level="1"]')].map(h => h.innerText.trim()).filter(Boolean)[0] || '';
    let navs = [...document.querySelectorAll('nav,[role=navigation]')];
    const navLinks = (navs.length ? navs.flatMap(n => [...n.querySelectorAll('a[href]')]) : [...document.querySelectorAll('a[href]')].slice(0, 15)).filter(vis).map(a => ({ href: a.getAttribute('href').startsWith('javascript:') ? (a.getAttribute('href').match(/['"]([^'"]+)['"]/) || [, a.getAttribute('href')])[1] : a.getAttribute('href'), name: nm(a) })).map(x => ({ ...x, key: norm(x.href) }));
    const comps = [...document.querySelectorAll('a[href],button,input[type=submit],input[type=image],[role=button],select,input[type=search]')].filter(vis).map(e => { let href = e.getAttribute('href') || ''; const js = href.match(/^javascript:.*?['"]([^'"]+)['"]/); if (js) href = js[1]; return { kind: e.tagName.toLowerCase(), key: href ? norm(href) : `${e.tagName.toLowerCase()}:${e.getAttribute('type') || ''}:${e.getAttribute('name') || e.id || ''}`, name: nm(e), img: e.querySelector('img')?.getAttribute('src')?.split('/').pop() || '' }; });
    const help = [...document.querySelectorAll('a[href]')].filter(vis).filter(a => /help|contact|support|faq|chat|phone|tel:|mailto:/i.test(a.innerText + ' ' + a.getAttribute('href'))).map(a => (a.innerText || a.getAttribute('href')).trim().slice(0, 30));
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=search]),textarea,select')].filter(vis).filter(e => !e.closest('[role=search],header,nav')).map(e => ({ label: (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || e.placeholder || e.name || '').trim(), ac: e.getAttribute('autocomplete') || '', value: e.value }));
    const sameAs = [...document.querySelectorAll('input[type=checkbox],input[type=radio]')].some(c => /same as|use (my )?(shipping|billing|previous)|copy/i.test((c.labels?.[0]?.innerText || '') + (c.getAttribute('aria-label') || '')));
    const self = norm(location.href); const notSelf = x => x.key !== self;
    const dedupe = a => a.filter((x, i) => a.findIndex(y => y.key === x.key) === i);
    return { title: document.title.trim(), h1, navLinks: dedupe(navLinks.filter(notSelf)), comps: comps.filter(notSelf), help, fields, sameAs };
  })) });
}
await browser.close();
const out = [header('sample-compare', `${urls.length} pages width=${width}${strip ? ' title-strip=' + strip : ''}`)];
if (urls.length < 3) out.push('NOTE: fewer than 3 pages; WCAG-EM consistency checks are weak.');
const flag = (f, x) => out.push(`${f}\t${x}`);
// 2.4.2
const core = t => strip ? t.replace(strip, '').trim() : t;
const byTitle = new Map(); data.forEach(d => { const k = core(d.title).toLowerCase(); byTitle.set(k, [...(byTitle.get(k) || []), d.url]); });
out.push('## Titles (2.4.2)'); data.forEach(d => out.push(`  "${d.title}"  h1="${d.h1.slice(0, 60)}"  ${d.url}`));
for (const [t, us] of byTitle) if (us.length > 1) flag('DUP-TITLE', `"${t}" on ${us.length} different pages: ${us.join(' , ')} (2.4.2: title must identify each page)`);
data.forEach(d => { const t = core(d.title); if (!t) flag('NO-TITLE', d.url); else if (/^(untitled|home|page|document|index|new page)\b/i.test(t) && !/home|index|^$/i.test(new URL(d.url).pathname.split('/').pop())) flag('GENERIC-TITLE', `"${t}" ${d.url}`); });
// 3.2.3 nav order
out.push('## Navigation (3.2.3)');
const seqs = data.map(d => d.navLinks.map(l => l.key)); const common = seqs.reduce((a, s) => a.filter(k => s.includes(k)), seqs[0] || []);
const orders = data.map(d => d.navLinks.map(l => l.key).filter(k => common.includes(k)).join(' > '));
if (new Set(orders).size > 1) data.forEach((d, i) => flag('NAV-ORDER-DIFFERS', `${d.url}: ${orders[i].slice(0, 200)}`)); else out.push(`  same relative order of ${common.length} shared nav links on all pages`);
// 3.2.4 identification (INCONSISTENT-NAME only for components on every sampled page, i.e. template parts)
out.push('## Identification (3.2.4)');
const byKey = new Map(); data.forEach(d => d.comps.forEach(c => { if (!byKey.has(c.key)) byKey.set(c.key, []); byKey.get(c.key).push({ url: d.url, ...c }); }));
for (const [k, list] of byKey) {
  const pagesWith = new Set(list.map(x => x.url)); if (pagesWith.size < 2) continue;
  const names = [...new Set(list.map(x => x.name.toLowerCase()))];
  if (names.includes('')) flag('UNNAMED-REPEATED', `${k} has no accessible name on ${list.filter(x => !x.name).length} instances across ${pagesWith.size} pages${list[0].img ? ' (img ' + list[0].img + ')' : ''} (3.2.4 + 4.1.2/2.4.4) on: ${[...new Set(list.filter(x => !x.name).map(x => x.url))].join(' , ')}`);
  // inconsistent only if two pages share no name at all for this destination/control
  const sets = [...pagesWith].map(u => new Set(list.filter(x => x.url === u && x.name).map(x => x.name.toLowerCase()))).filter(s => s.size);
  let disjoint = null; for (let i = 0; i < sets.length && !disjoint; i++) for (let j = i + 1; j < sets.length; j++) if (![...sets[i]].some(n => sets[j].has(n))) { disjoint = [sets[i], sets[j]]; break; }
  if (disjoint && pagesWith.size === data.length) flag('INCONSISTENT-NAME', `on: ${[...pagesWith].join(' , ')} ::` +  `${k}: ${[...disjoint[0]].slice(0, 3).map(n => '"' + n.slice(0, 40) + '"').join('/')} vs ${[...disjoint[1]].slice(0, 3).map(n => '"' + n.slice(0, 40) + '"').join('/')} (3.2.4 candidate: same function, different names?)`);
}
// 3.2.6 help
out.push('## Help (3.2.6, WCAG 2.2)');
const withHelp = data.filter(d => d.help.length); const helpSeq = data.map(d => d.help.join(' > ')); if (withHelp.length >= 2 && new Set(withHelp.map(d => d.help.join(' > '))).size > 1) data.forEach((d, i) => flag('HELP-ORDER-DIFFERS?', `${d.url}: ${helpSeq[i] || 'NONE'}`)); else out.push('  help/contact links consistent (or none)');
// 3.3.7 cue
out.push('## Repeated fields across steps (3.3.7 cue; only with --process: URLs = the steps of ONE process, in order)');
if (args.process) {
const seen = new Map(); data.forEach((d, i) => d.fields.forEach(f => { const k = (f.ac.replace(/^(shipping|billing)\s+/, '') || f.label.toLowerCase().replace(/[^a-z ]/g, '').trim()); if (!k) return; if (seen.has(k) && seen.get(k) !== d.url && !f.value && !d.sameAs) flag('REPEATED-FIELD?', `"${f.label}" on ${d.url} also asked on ${seen.get(k)}: empty, no "same as" option (3.3.7 candidate: confirm in a real multi-step run)`); if (!seen.has(k)) seen.set(k, d.url); }));
}
fs.writeFileSync(path.join(dir, 'sample-compare.txt'), out.join('\n') + '\n'); console.log(out.join('\n'));
