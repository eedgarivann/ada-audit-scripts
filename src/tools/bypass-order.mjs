// bypass-order: reading order (1.3.2), focus order vs visual order (2.4.3) and bypass blocks (2.4.1). Read-only.
// Every line is a candidate for a human to confirm (DOM + screenshot); nothing here is a definite failure.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readUrls, safePage, open, clickPrep, outDir, slug, sleep, header, writeJSON } from '../core/lib.mjs';
const args = parseArgs();
const urls = readUrls(args);
if (!urls.length) {
  console.error('usage: node bypass-order.mjs --urls ... [--widths 390,1440] [--scope "#page"] [--tabs 80]');
  process.exit(1);
}
const widths = String(args.widths || '390,1440')
    .split(',')
    .map(Number),
  tabs = Number(args.tabs || 80),
  scope = args.scope && args.scope !== true ? String(args.scope) : null;
const dir = outDir(args, 'bypass-order');

// In-page analysis of visual vs DOM order. Returns inversions grouped by container with a likely CSS cause.
const ORDER = (scopeSel) => {
  const root = (scopeSel && document.querySelector(scopeSel)) || document.body;
  const vis = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const r = e.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.right > 0 && r.left < innerWidth * 3;
  };
  const clipped = (e, r) => {
    for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (cs.overflow !== 'visible' || cs.clipPath !== 'none' || cs.clip !== 'auto') {
        const q = x.getBoundingClientRect();
        if (q.width < 2 || q.height < 2 || r.bottom <= q.top || r.top >= q.bottom || r.right <= q.left || r.left >= q.right) return true;
      }
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
    }
    return false;
  };
  const CHROME =
    'nav,header,footer,[role=navigation],[role=banner],[role=contentinfo],[role=menu],[role=menubar],[role=dialog],[aria-modal],[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=onetrust i],[class*=dropdown i],[class*=mega i],[class*=menu i]';
  const pinned = (e) => {
    for (let x = e; x && x !== document.body; x = x.parentElement) {
      const p = getComputedStyle(x).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  };
  const hiddenAT = (e) => !!e.closest('[aria-hidden="true"],[inert]');
  const sy = scrollY,
    sx = scrollX;
  const blocks = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let e = walker.currentNode; e; e = walker.nextNode()) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|PATH|HEAD)$/i.test(e.tagName)) continue;
    const own = [...e.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const isCtl = /^(IMG|INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.tagName) && !(e.tagName === 'IMG' && !e.getAttribute('alt'));
    if ((own.length < 2 && !isCtl) || !vis(e) || pinned(e) || hiddenAT(e)) continue;
    // text range rect (tighter than element box)
    let r = e.getBoundingClientRect();
    if (own.length >= 2) {
      const tn = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (tn) {
        const rg = document.createRange();
        rg.selectNodeContents(tn);
        const rr = rg.getBoundingClientRect();
        if (rr.width > 0) r = rr;
      }
    }
    if (clipped(e, r)) continue;
    blocks.push({
      el: e,
      text: (own || e.getAttribute('alt') || e.value || e.tagName).slice(0, 60),
      x: r.left + sx,
      y: r.top + sy,
      w: r.width,
      h: r.height,
      chrome: !!e.closest(CHROME),
      img: !own,
      head: /^H[1-6]$/.test(e.tagName) || e.getAttribute('role') === 'heading',
      len: own.length,
    });
  }
  const cause = (a, b) => {
    // nearest common ancestor chain styles that can reorder
    const anc = [];
    for (let x = a.el.parentElement; x; x = x.parentElement) {
      if (x.contains(b.el)) {
        anc.push(x);
        break;
      }
    }
    const c = anc[0];
    const out = [];
    if (!c) return { container: '?', causes: out };
    const chainA = [],
      chainB = [];
    for (let x = a.el; x && x !== c; x = x.parentElement) chainA.push(x);
    for (let x = b.el; x && x !== c; x = x.parentElement) chainB.push(x);
    const cs = getComputedStyle(c);
    if (/reverse/.test(cs.flexDirection) || /reverse/.test(cs.flexWrap)) out.push(`flex-direction:${cs.flexDirection}`);
    for (const x of [...chainA, ...chainB]) {
      const s = getComputedStyle(x);
      if (s.order !== '0') out.push(`order:${s.order} on ${x.tagName.toLowerCase()}`);
      if (s.position === 'absolute') out.push(`position:absolute on ${x.tagName.toLowerCase()}`);
      if (s.float !== 'none' && s.float === 'right') out.push(`float:right on ${x.tagName.toLowerCase()}`);
    }
    if (cs.display.includes('grid'))
      for (const x of [...chainA, ...chainB].filter((x) => x.parentElement === c)) {
        const s = getComputedStyle(x);
        if (s.gridRowStart !== 'auto' || s.gridColumnStart !== 'auto' || s.gridArea !== 'auto')
          out.push(`grid placement on ${x.tagName.toLowerCase()} (${s.gridRowStart}/${s.gridColumnStart})`);
      }
    if (cs.direction === 'rtl' && document.documentElement.dir !== 'rtl') out.push('direction:rtl');
    const tag =
      c.tagName.toLowerCase() +
      (c.id ? '#' + c.id : '') +
      (typeof c.className === 'string' && c.className.trim() ? '.' + c.className.trim().split(/\s+/)[0] : '');
    return { container: tag, causes: [...new Set(out)] };
  };
  const inv = new Map();
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < Math.min(blocks.length, i + 40); j++) {
      const a = blocks[i],
        b = blocks[j]; // a before b in DOM
      const hOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
        vOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      let kind = null;
      if (b.y + b.h / 2 < a.y && hOverlap > 0.3 * Math.min(a.w, b.w)) kind = 'later-in-DOM shown ABOVE';
      else if (vOverlap > 0.5 * Math.min(a.h, b.h) && b.x + b.w <= a.x - 4 && document.documentElement.dir !== 'rtl')
        kind = 'later-in-DOM shown LEFT (same line)';
      if (!kind) continue;
      const c = cause(a, b);
      if (!c.causes.length && kind.includes('LEFT')) continue; // side-by-side without reorder CSS: wrapping/inline noise
      const key = c.container;
      const g = inv.get(key) || { container: key, causes: new Set(), pairs: [], seq: false };
      c.causes.forEach((x) => g.causes.add(x));
      if (g.pairs.length < 4) g.pairs.push(`"${a.text}" (DOM first) vs "${b.text}" (${kind})`);
      g.n = (g.n || 0) + 1;
      const seqCue =
        (/\b(step \d|first|then|next|finally|^\d+[.)] )/i.test(a.text) && /\b(step \d|first|then|next|finally|^\d+[.)] )/i.test(b.text)) ||
        (/^\d+[.)]\s/.test(a.text) && /^\d+[.)]\s/.test(b.text)) ||
        /^step \d/i.test(a.text) ||
        /^step \d/i.test(b.text);
      const content = !a.chrome && !b.chrome && !a.img && !b.img && (a.len >= 15 || a.head) && (b.len >= 15 || b.head);
      if (seqCue && !a.chrome && !b.chrome) g.seq = true;
      if (content) g.content = true;
      inv.set(key, g);
    }
  const groups = [...inv.values()].map((g) => ({
    ...g,
    causes: [...g.causes],
    conf: g.causes.size && (g.seq || g.content) ? (g.seq ? 'high' : 'medium') : 'low',
  }));
  // layout tables (F49): data-less tables with side-by-side substantial cells
  const tables = [...root.querySelectorAll('table')].filter(
    (t) =>
      !t.querySelector('th,caption') && !t.getAttribute('summary') && !/presentation|none/.test(t.getAttribute('role') || '') && vis(t),
  );
  const layoutTables = tables
    .map((t) => {
      const rows = [...t.rows];
      const wide = rows.filter((r) => [...r.cells].filter((c) => c.innerText.trim().length > 30).length >= 2).length;
      const nested = !!t.querySelector('table');
      const span = !!t.querySelector('td[rowspan]');
      return { id: t.id || t.className || '', rows: rows.length, wide, nested, span };
    })
    .filter((t) => t.wide || t.nested || t.span);
  return { groups, layoutTables, blocks: blocks.length };
};

// Bypass facts in page
const BYPASS = (scopeSel) => {
  const root = (scopeSel && document.querySelector(scopeSel)) || document.body;
  const focusables = [
    ...root.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])'),
  ].filter((e) => !e.disabled && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const main = root.querySelector('main,[role=main]');
  const heads = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter((h) => h.getClientRects().length);
  const h1 = heads.find((h) => h.tagName === 'H1' || h.getAttribute('aria-level') === '1');
  const navs = root.querySelectorAll('nav,[role=navigation]').length;
  const contentStart = main || h1 || heads[0];
  const before = contentStart
    ? focusables.filter((f) => f.compareDocumentPosition(contentStart) & Node.DOCUMENT_POSITION_FOLLOWING && !contentStart.contains(f))
        .length
    : null;
  const skipRe = /skip|jump|go to (main|content)|to content|main content|aller au contenu|saltar|ir al contenido|zum inhalt/i;
  const allSkips = [...root.querySelectorAll('a[href*="#"]')]
    .filter(
      (a) =>
        skipRe.test(a.innerText + ' ' + (a.getAttribute('aria-label') || '')) &&
        (a.getAttribute('href').startsWith('#') || a.href.split('#')[0] === location.href.split('#')[0]),
    )
    .slice(0, 4)
    .map((a) => {
      const id = decodeURIComponent(a.getAttribute('href').split('#')[1] || '');
      const t = id && (document.getElementById(id) || document.getElementsByName(id)[0]);
      return {
        text: a.innerText.trim().slice(0, 50),
        href: a.getAttribute('href'),
        target: !!t,
        targetFocusable: !!t && (t.tabIndex >= 0 || t.hasAttribute('tabindex') || /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)),
        rendered: a.getClientRects().length > 0 && getComputedStyle(a).visibility !== 'hidden',
        index: focusables.indexOf(a),
      };
    });
  return {
    focusables: focusables.length,
    main: !!main,
    headings: heads.length,
    h1: !!h1,
    navs,
    before,
    skips: allSkips,
    lms: root.querySelectorAll('header,nav,main,footer,aside,[role]').length,
  };
};

for (const url of urls)
  for (const width of widths) {
    const { browser, page, blockedWrites } = await safePage(args, { width, height: width < 800 ? 844 : 900 });
    const lines = [header('bypass-order', `${url} width=${width}${scope ? ' scope=' + scope : ''}`)];
    const flags = [];
    const ev = {};
    try {
      await open(page, url);
      await clickPrep(page, args.click);
      await page.evaluate(() => scrollTo(0, 0));
      // ---- reading order
      const ord = await page.evaluate(ORDER, scope);
      ev.order = ord;
      for (const g of ord.groups) {
        if (g.conf === 'low') {
          lines.push(`info\tORDER-DIFF? (low: no reordering CSS found; may be normal layout) in ${g.container}: ${g.pairs[0]}`);
          continue;
        }
        flags.push(
          `READING-ORDER?(1.3.2,${g.conf})\t${g.container}\tcause: ${g.causes.join('; ')}\t${g.n} pair(s): ${g.pairs.join(' | ')}`,
        );
      }
      if (ord.layoutTables.length) {
        const T = ord.layoutTables;
        flags.push(
          `LAYOUT-TABLE-LINEAR?(1.3.2,medium)\t${T.length} layout table(s) without headers (${T.filter((t) => t.nested).length} nested, ${T.filter((t) => t.span).length} with rowspan, ${T.filter((t) => t.wide).length} with side-by-side text cells)\tread it cell by cell (linearized) and check the order still makes sense`,
        );
      }
      // ---- focus order vs visual (real Tab)
      await page.evaluate(() => {
        document.activeElement?.blur?.();
        scrollTo(0, 0);
      });
      const seq = [];
      for (let i = 0; i < tabs; i++) {
        await page.keyboard.press('Tab');
        await sleep(60);
        const f = await page.evaluate((s) => {
          const e = document.activeElement;
          if (!e || e === document.body) return null;
          const r = e.getBoundingClientRect();
          const inScope = !s || !!e.closest(s);
          return {
            inScope,
            tag: e.tagName.toLowerCase(),
            name: (e.getAttribute('aria-label') || e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40),
            x: r.left + scrollX,
            y: r.top + scrollY,
            w: r.width,
            h: r.height,
            ti: e.tabIndex,
            pinned: (() => {
              for (let x = e; x && x !== document.body; x = x.parentElement) {
                const p = getComputedStyle(x).position;
                if (p === 'fixed' || p === 'sticky') return true;
              }
              return false;
            })(),
          };
        }, scope);
        if (!f) break;
        if (seq.length && seq[0].x === f.x && seq[0].y === f.y && seq[0].name === f.name) break;
        seq.push(f);
      }
      const inS = seq.filter((f) => f.inScope && f.w > 0 && !f.pinned);
      for (let i = 1; i < inS.length; i++) {
        const a = inS[i - 1],
          b = inS[i];
        const up = b.y + b.h < a.y - 40,
          backLeft = Math.abs(b.y - a.y) < 10 && b.x + b.w < a.x - 10;
        if (!(up || backLeft)) continue;
        const pos = a.ti > 0 || b.ti > 0;
        const wrapToTop = up && b.y < 200 && i === inS.length - 1;
        if (wrapToTop) continue;
        const conf = pos ? 'high' : 'low';
        const msg = `FOCUS-ORDER-JUMP?(2.4.3/1.3.2,${conf})\tTab ${i}→${i + 1}: "${a.name}" (${Math.round(a.x)},${Math.round(a.y)}) → "${b.name}" (${Math.round(b.x)},${Math.round(b.y)}) ${up ? 'jumps UP' : 'jumps back LEFT'}${pos ? ' [positive tabindex]' : ''}`;
        if (conf === 'low') lines.push('info\t' + msg);
        else flags.push(msg);
      }
      ev.tabSeq = inS.length;
      // ---- bypass
      const by = await page.evaluate(BYPASS, scope);
      ev.bypass = by;
      // fresh page for a true first Tab (blur()/reload don't reliably reset Chrome's sequential-focus start)
      const sk = await safePage(args, { width, height: width < 800 ? 844 : 900 });
      const page2 = sk.page;
      await open(page2, url);
      await clickPrep(page2, args.click);
      const modalOpen = await page2.evaluate(() =>
        [...document.querySelectorAll('[aria-modal=true],dialog[open]')].some(
          (d) =>
            d.getBoundingClientRect().width >= 50 &&
            d.getBoundingClientRect().height >= 50 &&
            getComputedStyle(d).visibility !== 'hidden' &&
            Number(getComputedStyle(d).opacity) > 0,
        ),
      );
      if (modalOpen)
        lines.push(
          'info\ta modal dialog is open on load: skip-link test runs behind it and may be unreliable; close it with --click and rerun',
        );
      // real keyboard: first 3 Tab stops in scope, look for a skip link and try it
      let skipTest = null;
      const firstStops = [];
      let consentSkipped = 0,
        nulls = 0;
      for (let i = 0; i < 60 && firstStops.length < 3; i++) {
        await page2.keyboard.press('Tab');
        await sleep(80);
        const f = await page2.evaluate((s) => {
          const e = document.activeElement;
          if (!e || e === document.body) return null;
          if (s && !e.closest(s)) return { out: true };
          if (
            e.closest(
              '[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=onetrust i],[aria-label*=cookie i],[aria-label*=consent i]',
            )
          )
            return { out: true, consent: true };
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return {
            text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 50),
            href: e.getAttribute('href') || '',
            visible:
              r.width > 4 &&
              r.height > 4 &&
              r.bottom > 0 &&
              r.top < innerHeight &&
              r.right > 0 &&
              r.left < innerWidth &&
              cs.clip !== 'rect(0px, 0px, 0px, 0px)' &&
              Number(cs.opacity) > 0,
          };
        }, scope);
        if (!f) {
          if (++nulls > 6) break;
          await sleep(300);
          continue;
        }
        if (f.out) {
          if (f.consent) consentSkipped++;
          continue;
        }
        firstStops.push(f);
        if (/skip|jump|content|main|inhalt|contenido|contenu/i.test(f.text) && f.href.includes('#')) {
          const id = decodeURIComponent(f.href.split('#')[1] || '');
          if (!f.visible) {
            await sleep(500);
            f.visible = await page2.evaluate(() => {
              const e = document.activeElement,
                r = e.getBoundingClientRect(),
                cs = getComputedStyle(e);
              return (
                r.width > 4 &&
                r.height > 4 &&
                r.bottom > 0 &&
                r.top < innerHeight &&
                r.right > 0 &&
                r.left < innerWidth &&
                cs.clip !== 'rect(0px, 0px, 0px, 0px)' &&
                Number(cs.opacity) > 0
              );
            });
          } // allow slide-in transitions
          await page2.keyboard.press('Enter');
          await sleep(400);
          const after = await page2.evaluate((id) => {
            const t = document.getElementById(id) || document.getElementsByName(id)[0];
            const a = document.activeElement;
            return { target: !!t, focusIn: !!t && (a === t || t.contains(a)) };
          }, id);
          let nextInside = false;
          if (after.target && !after.focusIn) {
            await page2.keyboard.press('Tab');
            await sleep(80);
            nextInside = await page2.evaluate((id) => {
              const t = document.getElementById(id) || document.getElementsByName(id)[0];
              const a = document.activeElement;
              return (
                !!t && !!a && a !== document.body && (t.contains(a) || !!(t.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING))
              );
            }, id);
          }
          skipTest = {
            stop: firstStops.length,
            text: f.text,
            visibleOnFocus: f.visible,
            ...after,
            nextInside,
            works: after.target && (after.focusIn || nextInside),
          };
          break;
        }
      }
      await sk.browser.close().catch(() => {});
      ev.skipTest = skipTest;
      ev.firstStops = firstStops;
      const repeated = by.before === null ? by.focusables : by.before;
      const fallback = by.main || by.headings > 0;
      lines.push(
        `bypass facts: focusables=${by.focusables} before-content=${by.before ?? 'unknown (no main/heading)'} main=${by.main} headings=${by.headings} h1=${by.h1} nav=${by.navs} skip-links-in-DOM=${by.skips.length}`,
      );
      if (skipTest)
        lines.push(
          `skip test: Tab stop ${skipTest.stop} "${skipTest.text}" visible-on-focus=${skipTest.visibleOnFocus} target=${skipTest.target} focus-moved=${skipTest.focusIn} next-Tab-inside=${skipTest.nextInside}`,
        );
      if (!by.main) flags.push(`NO-MAIN-LANDMARK(2.4.1/1.3.1 advisory,low)\tno <main> or role=main`);
      if (!by.headings) flags.push(`NO-HEADINGS(2.4.1/1.3.1,medium)\tno headings to navigate by`);
      if (skipTest && !skipTest.target) flags.push(`SKIP-TARGET-MISSING(2.4.1,high)\t"${skipTest.text}" points to a missing id`);
      else if (skipTest && !skipTest.works)
        flags.push(`SKIP-NOT-MOVING-FOCUS(2.4.1,high)\t"${skipTest.text}": after Enter, focus and the next Tab stay outside the target`);
      if (skipTest && !skipTest.visibleOnFocus)
        flags.push(`SKIP-INVISIBLE-ON-FOCUS(2.4.7,medium)\t"${skipTest.text}" is not visible when focused`);
      if (!skipTest && by.skips.length && !modalOpen && consentSkipped)
        lines.push(
          `info\ta cookie/consent banner took the first ${consentSkipped} Tab stop(s); skip link "${by.skips[0].text}" not reached in the next 3 stops. Dismiss the banner (--click) and rerun`,
        );
      else if (!skipTest && by.skips.length && !modalOpen) {
        const s = by.skips[0];
        flags.push(
          `SKIP-NOT-FIRST(2.4.1,${s.rendered ? 'low' : 'high'})\t"${s.text}" ${s.rendered ? `is focusable #${s.index + 1} in DOM order but was not among the first 3 Tab stops${consentSkipped ? ' (cookie/consent controls came first)' : ''}` : 'is in the DOM but not rendered/focusable (display:none?)'}${s.target ? '' : '; target missing'}`,
        );
      }
      const skipOK = skipTest && skipTest.works;
      if (!skipOK && repeated >= 3 && !modalOpen) {
        if (!fallback)
          flags.push(
            `BYPASS-NONE(2.4.1,high)\t${repeated} focusable(s) before the content and no working skip link, main landmark or headings`,
          );
        else if (!(consentSkipped && by.skips.length))
          flags.push(
            `BYPASS-WEAK(advisory,low)\t${repeated} focusable(s) before the content; no working skip link (landmarks/headings exist, which can satisfy 2.4.1; a skip link still helps keyboard users)`,
          );
      }
      if (blockedWrites.length) lines.push(`blocked writes: ${blockedWrites.join(' | ')}`);
    } catch (e) {
      flags.push(`ERROR\t${e.message.split('\n')[0]}`);
    }
    const base = path.join(dir, `${slug(url)}_${width}`);
    fs.writeFileSync(
      base + '.txt',
      [...lines, '', '## Candidates (needs human confirmation)', ...(flags.length ? flags : ['none']), ''].join('\n'),
    );
    writeJSON(base + '.json', { url, width, scope, flags, evidence: ev });
    console.log(`${url} ${width}: ${flags.map((f) => f.split('\t')[0]).join(', ') || 'no candidates'}`);
    await browser.close();
  }
