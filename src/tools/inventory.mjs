// inventory: title, lang, headings, landmarks, skip link, images, overlays, demo pages, dead # links, third-party hosts; broken-image refetch; --site sitemap + WP REST
// v4 additions: alt quality (ALT-*), CSS background images (CSS-BG-IMAGE), heading/label quality (FAKE-HEADING?, HEADING-GENERIC, LABEL-GENERIC/DUP; 1.3.1/2.4.6),
// links told apart by colour only (LINK-COLOUR-ONLY?; 1.4.1), images of text (IMG-OF-TEXT?; 1.4.5) and an images.html contact sheet for the manual alt-vs-pixels review.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readUrls, safePage, open, scrollThrough, outDir, slug, header } from '../core/lib.mjs';
const args = parseArgs();
let urls = readUrls(args);
const OVERLAY = /accessibe|acsbapp|userway|audioeye|equalweb|maxaccess|accessibly|enable\.co\.il|purpose-?ai|allyable|reciteme/i;
const DEMO = /demo|sample|lorem|hello-world|placeholder|starter|test-?page|template|example|dummy/i;
const dir = outDir(args, 'inventory');
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const QUALITY = `(() => {
  const flags = [], sheet = []; let n = 0;
  const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const sel = e => { e.setAttribute('data-ada-q', ++n); return '[data-ada-q="' + n + '"]'; };
  const txt = e => (e?.innerText || '').trim().replace(/\\s+/g, ' ');
  const file = s => (s || '').split(/[?#]/)[0].split('/').pop();
  const GENERIC_ALT = /^(image|img|picture|pic|photo|graphic|icon|logo|spacer|bullet|arrow|button|banner|captcha|untitled|placeholder|alt|null|blank|\\*|-|\\.|\\s*)$/i;
  const altSeen = new Map();
  for (const i of document.images) {
    if (!vis(i)) continue; const alt = i.getAttribute('alt'); const src = i.currentSrc || i.src; const w = i.width, h = i.height; const f = [];
    const link = i.closest('a,button'); const lt = link ? txt(link) : '';
    if (alt === null) f.push('ALT-MISSING');
    else if (alt.trim() && /\\.(gif|jpe?g|png|svg|webp|bmp)$/i.test(alt.trim())) f.push('ALT-FILENAME');
    else if (alt.trim() && GENERIC_ALT.test(alt.trim())) f.push('ALT-GENERIC');
    if (alt && alt.length > 150) f.push('ALT-LONG');
    if (alt && (w <= 3 || h <= 3 || /spacer|pixel|blank|transparent|dot\\.gif|1x1/i.test(src))) f.push('ALT-ON-SPACER');
    if (alt === '' && link && !lt && !link.getAttribute('aria-label')) f.push('ALT-EMPTY-IN-EMPTY-LINK');
    if (alt && link && lt && lt.toLowerCase().includes(alt.trim().toLowerCase()) && lt.trim().toLowerCase() !== alt.trim().toLowerCase()) f.push('ALT-REDUNDANT?');
    if (alt && alt.trim()) { const k = alt.trim().toLowerCase(); if (altSeen.has(k) && altSeen.get(k) !== file(src)) f.push('SAME-ALT-DIFF-IMAGE?'); else altSeen.set(k, file(src)); }
    if ((/(^|[_-])(nav|btn|button|title|heading|text|head|menu|tab)[_-]?|telefon|phone/i.test(file(src)) || (w >= 3 * h && h >= 12 && h <= 80 && alt && alt.trim().split(/\\s+/).length <= 6)) && !/logo/i.test(file(src) + alt)) f.push('IMG-OF-TEXT?');
    sheet.push({ kind: 'img', sel: sel(i), alt: alt === null ? '(no alt)' : alt, src: file(src), ctx: link ? (link.tagName.toLowerCase() + ' "' + lt.slice(0, 40) + '"') : txt(i.parentElement).slice(0, 50), flags: f });
    if (f.length) flags.push(f.join(' ') + '\\timg ' + file(src) + ' alt=' + (alt === null ? '(none)' : JSON.stringify(alt.slice(0, 60))) + (link ? ' in link "' + lt.slice(0, 30) + '"' : ''));
  }
  // CSS background images that may carry information (F3). Skip big layout backgrounds and gradients.
  for (const e of document.querySelectorAll('body *')) {
    const bg = getComputedStyle(e).backgroundImage; if (!bg || bg === 'none' || !/url\\(/.test(bg) || !vis(e)) continue;
    const r = e.getBoundingClientRect(); if (r.width * r.height > 250000 || r.width < 16 || r.height < 16) continue;
    const ownText = [...e.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()) || !!txt(e);
    const named = e.getAttribute('aria-label') || e.getAttribute('role') === 'img';
    const f = ['CSS-BG-IMAGE'];
    if (e.getAttribute('title') && !named) f.push('TITLE-ONLY');
    if (!ownText && !named) f.push('NO-TEXT-ALTERNATIVE');
    const u = (bg.match(/url\\(["']?([^"')]+)/) || [])[1];
    sheet.push({ kind: 'css-bg', sel: sel(e), alt: e.getAttribute('aria-label') || e.getAttribute('title') || '(none)', src: file(u), ctx: e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height), flags: f });
    if (f.length > 1) flags.push(f.join(' ') + '\\t' + e.tagName.toLowerCase() + ' bg=' + file(u) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + (e.getAttribute('title') ? ' title=' + JSON.stringify(e.getAttribute('title')) : '') + ' (1.1.1 if it informs: review pixels)');
  }
  // headings: generic/duplicate (2.4.6); fake headings: short, visually prominent text not marked up (1.3.1, 2.4.6)
  const bodyFs = parseFloat(getComputedStyle(document.body).fontSize) || 16;
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(vis);
  const hSeen = {};
  for (const h of hs) { const t = txt(h); if (!t) flags.push('HEADING-EMPTY\\t' + h.tagName); else if (/^(heading|title|untitled|section|text|header|more|welcome|click here|new|item|content)\\s*\\d*$/i.test(t)) flags.push('HEADING-GENERIC\\t"' + t + '" (2.4.6)'); const k = h.tagName + t.toLowerCase(); if (t && hSeen[k]++ >= 1) flags.push('HEADING-DUP\\t' + h.tagName + ' "' + t.slice(0, 50) + '" (2.4.6 if they label different sections)'); hSeen[k] = hSeen[k] || 1; }
  const fake = [];
  for (const e of document.querySelectorAll('p,div,span,td,b,strong,font,center')) {
    if (!vis(e) || e.closest('h1,h2,h3,h4,h5,h6,[role=heading],a,button,label,legend,caption,th,nav,header > a')) continue;
    const t = txt(e); if (!t || t.length > 80 || t.split(/\\s+/).length > 10 || /[.:,;]$/.test(t) && !/[!?]$/.test(t)) continue;
    if ([...e.children].some(c => /^(P|DIV|TABLE|UL|OL|SPAN|B|STRONG|FONT)$/.test(c.tagName) && txt(c) === t)) continue; // innermost only
    const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 600 || /bold/.test(cs.fontWeight);
    const alone = e.parentElement && txt(e.parentElement).length > t.length + 20; // followed/preceded by other content
    if ((fs >= bodyFs * 1.2 || (bold && fs >= bodyFs && /^(P|DIV|TD|B|STRONG)$/.test(e.tagName) && e.parentElement && [...e.parentElement.childNodes].filter(c => c.nodeType === 1 || c.textContent.trim()).length > 1)) && alone) fake.push(e.tagName.toLowerCase() + ' "' + t.slice(0, 50) + '" ' + Math.round(fs) + 'px' + (bold ? ' bold' : ''));
  }
  [...new Set(fake)].slice(0, 25).forEach(x => flags.push('FAKE-HEADING?\\t' + x + ' (1.3.1 + 2.4.6: looks like a heading, is not one)'));
  if (!hs.filter(h => !h.closest('header,[role=banner],nav,footer')).length && fake.length) flags.push('NO-REAL-HEADINGS\\tcontent sections use styled text, not headings (1.3.1, 2.4.6 "headings not programmatically determined")');
  // labels: generic or duplicated within a form (2.4.6)
  for (const f of document.querySelectorAll('form')) { const seen = {}; for (const c of f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]),select,textarea')) { if (!vis(c)) continue; const l = (c.labels?.[0] ? txt(c.labels[0]) : c.getAttribute('aria-label') || '').trim(); if (!l) continue; if (/^(field|input|text|enter|value|\\*|:|select|choose|option|\\?)\\s*\\d*:?$/i.test(l)) flags.push('LABEL-GENERIC\\t"' + l + '" (2.4.6)'); if (seen[l.toLowerCase()] && c.type !== 'radio' && c.type !== 'checkbox') flags.push('LABEL-DUP\\t"' + l + '" used for 2+ fields (2.4.6)'); seen[l.toLowerCase()] = 1; } }
  // links in text distinguished by colour only (1.4.1, F73)
  const lum = c => { const m = c.match(/\\d+(\\.\\d+)?/g); if (!m) return 0; const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(+m[0]) + 0.7152 * f(+m[1]) + 0.0722 * f(+m[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  let lc = 0; const hoverCands = [];
  for (const a of document.querySelectorAll('p a[href], li a[href], td a[href]')) {
    const p = a.parentElement; const own = [...p.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join('').trim(); if (own.length < 15 || !vis(a)) continue;
    const ca = getComputedStyle(a), cp = getComputedStyle(p); if (/underline/.test(ca.textDecorationLine) || ca.borderBottomStyle !== 'none' || ca.fontWeight !== cp.fontWeight || ca.fontStyle !== cp.fontStyle) continue;
    const r = ratio(ca.color, cp.color); if (r >= 3) { if (hoverCands.length < 8) hoverCands.push({ sel: sel(a), text: txt(a).slice(0, 40), r: r.toFixed(2) }); continue; }
    if (lc++ < 10) flags.push('LINK-COLOUR-ONLY?\\t"' + txt(a).slice(0, 40) + '" ' + ca.color + ' vs text ' + cp.color + ' = ' + r.toFixed(2) + ':1, no underline (1.4.1, F73: check hover/focus cue too)');
  }
  return { flags, sheet, hoverCands };
})()`;
const get = async (u) => {
  try {
    const r = await fetch(u, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'ada-audit-scripts/4.0.0 (read-only)' } });
    return {
      status: r.status,
      type: r.headers.get('content-type') || '',
      text: (r.headers.get('content-type') || '').match(/xml|json|html|text/) ? await r.text() : '',
    };
  } catch (e) {
    return { status: 0, type: '', text: '', err: e.message };
  }
};
if (args.site) {
  const origin = new URL(args.site).origin;
  const found = new Set();
  const queue = [origin + '/sitemap.xml', origin + '/sitemap_index.xml', origin + '/wp-sitemap.xml'];
  const robots = await get(origin + '/robots.txt');
  for (const m of robots.text.matchAll(/^sitemap:\s*(\S+)/gim)) queue.unshift(m[1]);
  const seenMaps = new Set();
  while (queue.length && found.size < 2000) {
    const sm = queue.shift();
    if (seenMaps.has(sm)) continue;
    seenMaps.add(sm);
    const r = await get(sm);
    if (r.status !== 200) continue;
    for (const m of r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const u = m[1].replace(/&amp;/g, '&');
      if (/\.xml(\?|$)/i.test(u)) queue.push(u);
      else if (found.size < 2000) found.add(u);
    }
  }
  const sitemapSet = new Set(found);
  const wp = [];
  for (const t of ['pages', 'posts']) {
    for (let p = 1; p <= 20; p++) {
      const r = await get(`${origin}/wp-json/wp/v2/${t}?per_page=100&page=${p}&_fields=link,status`);
      if (r.status !== 200) break;
      let j;
      try {
        j = JSON.parse(r.text);
      } catch {
        break;
      }
      if (!Array.isArray(j) || !j.length) break;
      j.forEach((x) => wp.push(x.link));
    }
  }
  const missing = wp.filter((u) => !sitemapSet.has(u));
  wp.forEach((u) => found.add(u));
  const lines = [
    header('inventory --site', origin),
    `sitemap URLs: ${sitemapSet.size} (cap 2000)`,
    `WP REST pages/posts: ${wp.length}`,
    `published but missing from sitemap: ${missing.length}`,
    ...missing.map((u) => '  MISSING-FROM-SITEMAP ' + u),
    '',
    'ALL:',
    ...[...found].map((u) => (DEMO.test(u) ? 'DEMO? ' : '      ') + u),
  ];
  fs.writeFileSync(path.join(dir, 'site-pages.txt'), lines.join('\n') + '\n');
  console.log(lines.slice(0, 6).join('\n'));
  if (!urls.length) urls = [...found].slice(0, 25);
}
if (!urls.length) {
  console.error('usage: node inventory.mjs (--site https://x | --urls ...)');
  process.exit(1);
}
const { browser, page } = await safePage(args, { width: 1440, height: 900 });
const broken = new Map();
page.on('response', (r) => {
  if (r.request().resourceType() === 'image' && r.status() >= 400) broken.set(r.url(), r.status());
});
page.on('requestfailed', (r) => {
  if (r.resourceType() === 'image') broken.set(r.url(), 'failed ' + (r.failure()?.errorText || ''));
});
for (const url of urls) {
  broken.clear();
  await open(page, url);
  await scrollThrough(page);
  const d = await page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.getAttribute('lang'),
    xmlLang: document.documentElement.getAttribute('xml:lang'),
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].map(
      (h) =>
        `${h.tagName}${h.getAttribute('aria-level') ? '(' + h.getAttribute('aria-level') + ')' : ''}: ${h.innerText.trim().replace(/\s+/g, ' ').slice(0, 70)}`,
    ),
    landmarks: [
      ...document.querySelectorAll(
        'header,nav,main,footer,aside,[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=complementary],[role=search],form[aria-label],section[aria-label]',
      ),
    ].map(
      (l) =>
        `${l.getAttribute('role') || l.tagName.toLowerCase()}${l.getAttribute('aria-label') ? ' "' + l.getAttribute('aria-label') + '"' : ''}`,
    ),
    skip: [...document.querySelectorAll('a[href^="#"]')]
      .slice(0, 5)
      .filter((a) => /skip|jump|content|main/i.test(a.innerText))
      .map(
        (a) => `${a.innerText.trim()} -> ${a.getAttribute('href')} target=${!!document.getElementById(a.getAttribute('href').slice(1))}`,
      ),
    images: [...document.images].map((i) => ({ src: i.currentSrc || i.src, alt: i.getAttribute('alt'), w: i.naturalWidth })),
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
    iframes: [...document.querySelectorAll('iframe')].map((f) => f.src),
    deadHash: [...document.querySelectorAll('a[href="#"],a[href=""],a[href^="javascript:"]')].map(
      (a) => `${a.getAttribute('href').slice(0, 40)} "${(a.innerText || a.querySelector('img')?.alt || '').trim().slice(0, 40)}"`,
    ),
    links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
  }));
  const host = new URL(url).host;
  const hosts = new Set();
  [...d.scripts, ...d.iframes, ...d.images.map((i) => i.src)].forEach((s) => {
    try {
      const h = new URL(s).host;
      if (h && h !== host) hosts.add(h);
    } catch {}
  });
  const overlays = [...d.scripts, ...d.iframes].filter((s) => OVERLAY.test(s));
  const imgLines = [];
  for (const [u, st] of broken) {
    const r = await get(u);
    imgLines.push(
      `BROKEN-IN-BROWSER ${u} (${st}); direct fetch ${r.status} ${r.type}${/^image\//.test(r.type) && r.status === 200 ? ' → ENVIRONMENT ARTIFACT (not a finding)' : ' → candidate finding'}`,
    );
  }
  const lines = [
    header('inventory', url),
    `title: ${d.title}`,
    `lang: ${d.lang} xml:lang: ${d.xmlLang}${!d.lang ? '  NO-LANG (3.1.1 candidate)' : ''}`,
    `headings (${d.headings.length}): ${d.headings.length ? '' : 'NONE'}`,
    ...d.headings.map((h) => '  ' + h),
    `landmarks: ${d.landmarks.join(', ') || 'NONE'}`,
    `skip links: ${d.skip.join(' | ') || 'none found'}`,
    `images: ${d.images.length}; missing alt attr: ${d.images.filter((i) => i.alt === null).length}; empty alt: ${d.images.filter((i) => i.alt === '').length}; filename-like alt: ${d.images.filter((i) => i.alt && /\.(gif|jpe?g|png|svg|webp)$/i.test(i.alt)).length}`,
    ...imgLines,
    `overlays: ${overlays.length ? overlays.join(' ') : 'none detected'}`,
    `demo/placeholder URL: ${DEMO.test(url) ? 'YES (check)' : 'no'}`,
    `dead/# / javascript: links (${d.deadHash.length}):`,
    ...d.deadHash.slice(0, 20).map((x) => '  ' + x),
    `third-party hosts: ${[...hosts].join(', ') || 'none'}`,
  ];
  const q = await page.evaluate(QUALITY);
  // G183: colour-distinguished links (>=3:1 vs text) still need a non-colour cue on hover AND focus
  for (const c of q.hoverCands) {
    const loc = page.locator(c.sel).first();
    const st = () =>
      loc
        .evaluate((e) => {
          const s = getComputedStyle(e);
          return [s.textDecorationLine, s.borderBottomStyle, s.fontWeight, s.outlineStyle, s.backgroundColor].join('|');
        })
        .catch(() => '');
    const s0 = await st();
    await loc.hover({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(150);
    const sh = await st();
    await page.mouse.move(0, 0);
    const fo = await loc
      .evaluate((e) => {
        e.focus();
        const s = getComputedStyle(e);
        const r = [s.textDecorationLine, s.borderBottomStyle, s.fontWeight, s.outlineStyle, s.backgroundColor].join('|');
        e.blur();
        return r;
      })
      .catch(() => s0);
    if (sh === s0 || fo === s0)
      q.flags.push(
        `LINK-COLOUR-ONLY?\t"${c.text}" ${c.r}:1 vs text, no underline; non-colour cue on hover: ${sh !== s0} focus: ${fo !== s0} (1.4.1 G183 needs both; check visually)`,
      );
  }
  lines.push('## quality candidates (confirm each in DOM + screenshot)', ...(q.flags.length ? q.flags : ['none']));
  // contact sheet: every image + CSS background, with its alt, for the manual alt-vs-pixels review (1.1.1)
  const sheetDir = path.join(dir, `${slug(url)}_images`);
  fs.mkdirSync(sheetDir, { recursive: true });
  const rows = [];
  for (const [i, it] of q.sheet.slice(0, 80).entries()) {
    const f = `${String(i).padStart(2, '0')}.png`;
    const ok = await page
      .locator(it.sel)
      .first()
      .screenshot({ path: path.join(sheetDir, f), timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    rows.push(
      `<tr><td>${ok ? `<img src="${slug(url)}_images/${f}" style="max-width:240px;max-height:120px">` : '(no shot)'}</td><td>${it.kind}</td><td>${esc(it.alt)}</td><td>${esc(it.src)}</td><td>${esc(it.ctx)}</td><td>${it.flags.join(' ')}</td></tr>`,
    );
  }
  fs.writeFileSync(
    path.join(dir, `${slug(url)}_images.html`),
    `<!doctype html><meta charset=utf-8><title>Alt review ${esc(url)}</title><h1>Alt review: ${esc(url)}</h1><p>For each row: does the alt (or lack of it) give the same information as the pixels in this context? Decorative = alt="". Informative CSS backgrounds need a text alternative (F3).</p><table border=1 cellpadding=4><tr><th>Pixels</th><th>Kind</th><th>alt / name</th><th>src</th><th>Context</th><th>Flags</th></tr>${rows.join('')}</table>`,
  );
  lines.push(`alt review sheet: ${path.join(dir, slug(url) + '_images.html')}`);
  fs.writeFileSync(path.join(dir, `${slug(url)}.txt`), lines.join('\n') + '\n');
  console.log(lines.join('\n') + '\n');
}
await browser.close();
