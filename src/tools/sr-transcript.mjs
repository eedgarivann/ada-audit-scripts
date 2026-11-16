// sr-transcript: Guidepup Virtual Screen Reader injected into the page (no network). SIMULATED — not JAWS/NVDA/VoiceOver.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BODY_STATE, trackFocus, parseArgs, readUrls, safePage, open, clickPrep, outDir, slug, sleep, VIEWPORTS } from '../core/lib.mjs';
const require = createRequire(import.meta.url);
const args = parseArgs();
const urls = readUrls(args);
if (!urls.length) {
  console.error('usage: node sr-transcript.mjs --urls ... [--desktop] [--max 1500] [--tabs 60]');
  process.exit(1);
}
const max = Number(args.max || 1500),
  tabs = Number(args.tabs || 60);
const vp = args.desktop ? VIEWPORTS.desktop : VIEWPORTS.mobile;
const BANNER =
  'Simulated screen reader output (Guidepup Virtual Screen Reader). Not JAWS, NVDA or VoiceOver; confirm with a real screen reader.';
const pkgDir = path.dirname(require.resolve('@guidepup/virtual-screen-reader/package.json'));
const vsrVersion = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
let bundle = fs.readFileSync(path.join(pkgDir, 'lib/esm/index.browser.js'), 'utf8');
bundle = bundle.replace(
  /export\s*\{([^}]*)\}\s*;?/,
  (m, inner) =>
    `window.__vsr={${inner
      .split(',')
      .map((p) => {
        const [a, b] = p.trim().split(/\s+as\s+/);
        return `${(b || a).trim()}:${a.trim()}`;
      })
      .join(',')}};`,
);
bundle = bundle.replace(/\/\/# sourceMappingURL=.*$/m, '');
const dir = outDir(args, 'sr-transcript');
const VAGUE = /^(link,? )?(click here|here|read more|more|learn more|details|continue|go|this|link|more info|info)$/i;
const FILE = /\b[\w-]+\.(gif|jpe?g|png|svg|webp|bmp)\b|\b(img|image|dsc|photo|pic)[_-]?\d+/i;
for (const url of urls) {
  const { browser, page } = await safePage(args, vp);
  await open(page, url);
  await clickPrep(page, args.click);
  await page
    .evaluate((code) => {
      const s = document.createElement('script');
      s.type = 'module';
      s.textContent = code;
      document.head.appendChild(s);
    }, bundle)
    .catch(() => {});
  await page.waitForFunction(() => !!window.__vsr, null, { timeout: 15000 }).catch(() => {});
  let ok = await page.evaluate(() => !!window.__vsr);
  if (!ok) {
    // CSP may block inline module: fall back to evaluating as function body
    await page
      .evaluate(
        (code) => {
          (0, eval)(code.replace(/window\.__vsr=/, 'window.__vsr='));
        },
        bundle.replace(/^import .*$/gm, ''),
      )
      .catch((e) => console.error('inject failed', e.message));
    ok = await page.evaluate(() => !!window.__vsr);
  }
  if (!ok) {
    console.error(`${url}: could not inject virtual screen reader`);
    await browser.close();
    continue;
  }
  const res = await page.evaluate(
    async ({ max }) => {
      const v = window.__vsr.virtual;
      document.querySelectorAll('noscript').forEach((n) => n.remove());
      await v.start({ container: document.body });
      let n = 0;
      while (n++ < max) {
        const last = await v.lastSpokenPhrase();
        if (last === 'end of document') break;
        await v.next();
      }
      const linear = await v.spokenPhraseLog();
      await v.stop();
      const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')]
        .filter((h) => h.offsetParent !== null || getComputedStyle(h).position === 'fixed')
        .map((h) => ({
          level: Number(h.getAttribute('aria-level') || h.tagName.slice(1)) || 2,
          text: h.innerText.trim().replace(/\s+/g, ' ').slice(0, 80),
        }));
      const lms = [
        ...document.querySelectorAll(
          'header,nav,main,footer,aside,[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=complementary],[role=search],[role=region][aria-label],section[aria-label]',
        ),
      ].map((l) => l.getAttribute('role') || l.tagName.toLowerCase());
      const layoutTables = [...document.querySelectorAll('table')].filter(
        (t) => !t.querySelector('th,caption') && t.getAttribute('role') !== 'presentation',
      ).length;
      const positive = [...document.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0).length;
      const genericClick = [...document.querySelectorAll('div[onclick],span[onclick],img[onclick],td[onclick]')]
        .filter((e) => !e.getAttribute('role'))
        .map((e) => e.tagName.toLowerCase() + ' "' + (e.innerText || e.getAttribute('alt') || '').trim().slice(0, 40) + '"');
      // builder addition: virtual SR says just "image" for alt-less <img>; real SRs (VoiceOver, JAWS) often speak the src filename
      const noAlt = [...document.images]
        .filter(
          (i) =>
            !i.hasAttribute('alt') &&
            !i.getAttribute('aria-label') &&
            !i.getAttribute('aria-labelledby') &&
            i.getAttribute('role') !== 'presentation',
        )
        .map((i) => (i.getAttribute('src') || '').split('/').pop().slice(0, 60));
      const focusGeneric = [...document.querySelectorAll('div[tabindex],span[tabindex]')].filter(
        (e) => !e.getAttribute('role') && e.getAttribute('tabindex') !== '-1',
      ).length;
      return { linear, headings, lms, layoutTables, positive, genericClick, focusGeneric, noAlt };
    },
    { max },
  );
  // real Tab pass (keyboard), reading the focused element's computed accessible name from the a11y tree
  const tabLog = [];
  let last = '',
    rep = 0;
  await trackFocus(page);
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    scrollTo(0, 0);
  });
  for (let i = 1; i <= tabs; i++) {
    await page.keyboard.press('Tab');
    await sleep(120);
    const f = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      return {
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute('role') || '',
        aria:
          e.getAttribute('aria-label') ||
          (e.labels && e.labels[0] ? e.labels[0].innerText.trim() : null) ||
          (e.getAttribute('aria-labelledby')
            ? e
                .getAttribute('aria-labelledby')
                .split(/\s+/)
                .map((i) => document.getElementById(i)?.innerText || '')
                .join(' ')
                .trim()
            : null),
        text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160),
        alt: [...e.querySelectorAll('img')]
          .map((i) => i.getAttribute('alt'))
          .filter((a) => a !== null)
          .join(' '),
        title: e.getAttribute('title') || '',
        href: e.getAttribute('href') || '',
        value: e.value || '',
      };
    });
    if (!f) {
      const bs = await page.evaluate(BODY_STATE);
      tabLog.push(
        bs.endOfOrder
          ? `${i}\t<body>\tEND-OF-TAB-ORDER`
          : `${i}\t<body>\tFOCUS-LOST after ${bs.lastTag}${bs.lastBlurredByScript ? ' (onfocus=blur)' : ''}`,
      );
      rep = last === 'BODY' ? rep + 1 : 1;
      last = 'BODY';
      if (rep >= 10) {
        tabLog.push('HALT: focus stuck on body');
        break;
      }
      continue;
    }
    const name = (f.aria || f.text || f.alt || f.title || (f.tag === 'select' ? '' : f.value)).trim();
    const key = f.tag + name + f.href;
    rep = key === last ? rep + 1 : 1;
    last = key;
    const flags = [];
    if (!name) flags.push('NO-NAME');
    if (FILE.test(name)) flags.push('IMG-FILENAME(?)');
    if (f.tag === 'a' && VAGUE.test(name)) flags.push('VAGUE-LINK');
    if (name.length > 150) flags.push('LONG-NAME');
    if (rep >= 3) flags.push('REPEAT(trap?)');
    if (/^(div|span)$/.test(f.tag) && !f.role) flags.push('FOCUSABLE-GENERIC');
    tabLog.push(`${i}\t${f.role || f.tag}\t"${name.slice(0, 160)}"\t${flags.join(' ')}`);
  }
  // flags on the linear read
  const flags = [];
  const counts = {};
  res.linear.forEach((p, i) => {
    const t = String(p);
    if (/^(link|button|image|img|graphic)$/i.test(t.trim())) flags.push(`${i}\tNO-NAME\t${t}`);
    if (FILE.test(t)) flags.push(`${i}\tIMG-FILENAME(?)\t${t.slice(0, 120)}`);
    const lm = t.match(/^link,\s*(.*)$/i);
    if (lm) {
      if (VAGUE.test(lm[1].trim())) flags.push(`${i}\tVAGUE-LINK\t${t}`);
      counts[lm[1]] = (counts[lm[1]] || 0) + 1;
    }
    // fix: LONG-NAME only for named controls/images, not containers (row/cell) or text
    const nm = t.match(/^(link|button|image|img|graphic|combobox|textbox|checkbox|radio|heading),\s*(.*)$/i);
    if (nm && nm[2].length > 150) flags.push(`${i}\tLONG-NAME(${nm[2].length})\t${t.slice(0, 100)}…`);
  });
  for (const [k, c] of Object.entries(counts)) if (c > 1 && k) flags.push(`-\tDUPLICATE x${c}\tlink, ${k.slice(0, 80)}`);
  if (!res.headings.length) flags.push('-\tNO-HEADINGS');
  else {
    if (!res.headings.some((h) => h.level === 1)) flags.push('-\tNO-H1');
    for (let i = 1; i < res.headings.length; i++)
      if (res.headings[i].level - res.headings[i - 1].level > 1)
        flags.push(`-\tHEADING-SKIP h${res.headings[i - 1].level}→h${res.headings[i].level} "${res.headings[i].text}"`);
  }
  if (!res.lms.some((l) => l === 'main')) flags.push('-\tNO-MAIN');
  if (res.layoutTables) flags.push(`-\tLAYOUT-TABLE? x${res.layoutTables}`);
  if (res.positive) flags.push(`-\tPOSITIVE-TABINDEX x${res.positive}`);
  res.genericClick.forEach((g) => flags.push(`-\tGENERIC-CLICKABLE\t${g}`));
  res.noAlt.forEach((f) => flags.push(`-\tIMG-FILENAME(?)\tno alt; real SR may say "${f}"`));
  if (res.focusGeneric) flags.push(`-\tFOCUSABLE-GENERIC x${res.focusGeneric}`);
  const fl = tabLog.filter((l) => /FOCUS-LOST/.test(l)).length;
  if (fl) flags.push(`-\tFOCUS-LOST x${fl} (Tab pass)`);
  const out = [
    BANNER,
    `# ${url} | ${args.desktop ? 'desktop 1440' : 'mobile 390'} | @guidepup/virtual-screen-reader ${vsrVersion} | ${new Date().toISOString()}`,
    '',
    '## Flags (candidates; confirm each in DOM + screenshot)',
    ...flags,
    '',
    '## Headings',
    ...res.headings.map((h) => `h${h.level} ${h.text}`),
    '',
    '## Landmarks',
    res.lms.join(', ') || 'NONE',
    '',
    '## Tab pass (real keyboard)',
    ...tabLog,
    '',
    `## Linear read (${res.linear.length} phrases, cap ${max})${res.linear.length >= max ? ' WARNING: cap hit, transcript truncated (raise --max)' : ''}`,
    ...res.linear,
  ];
  const file = path.join(dir, `${slug(url)}_${args.desktop ? 1440 : 390}.txt`);
  fs.writeFileSync(file, out.join('\n') + '\n');
  const sum = {};
  flags.forEach((f) => {
    const k = f.split('\t')[1].split(/[ (]/)[0];
    sum[k] = (sum[k] || 0) + 1;
  });
  console.log(`${url} ${args.desktop ? 1440 : 390}: ${JSON.stringify(sum)} -> ${file}`);
  await browser.close();
}
