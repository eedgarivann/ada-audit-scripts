// context-change: 3.2.1 On Focus, 3.2.2 On Input, 2.1.1 mouse-only handlers, 2.2.1 timeouts. Read-only:
// navigations triggered by focus/input are aborted (guardNavigation) and logged, never followed.
// Flags: FOCUS-REMOVED (F55: 2.1.1, 2.4.7, 3.2.1), FOCUS-CHANGES-CONTEXT (3.2.1), CHANGE-ON-INPUT (3.2.2),
// MOUSE-ONLY (2.1.1; handler on a non-focusable element), TIMEOUT-NAV (2.2.1; with --idle), TIMEOUT-SCRIPT? (static).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readUrls, safePage, open, clickPrep, outDir, slug, sleep, header, guardNavigation } from '../core/lib.mjs';
const args = parseArgs();
const urls = readUrls(args);
if (!urls.length) {
  console.error('usage: node context-change.mjs --urls ... [--width 1440] [--idle 0 (seconds to wait for timeouts)] [--max 150]');
  process.exit(1);
}
const width = Number(args.width || 1440),
  idle = Number(args.idle || 0),
  max = Number(args.max || 150);
const dir = outDir(args, 'context-change');
const TABBABLE =
  'a[href],button,input:not([type=hidden]),select,textarea,iframe,summary,[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
for (const url of urls) {
  const { browser, page, context } = await safePage(args, { width, height: width < 800 ? 844 : 900 });
  const g = await guardNavigation(page);
  await open(page, url);
  await clickPrep(page, args.click);
  const out = [header('context-change', `${url} width=${width}`)];
  const flags = [];
  // 1. Static scan: inline handlers and click listeners on non-focusable elements (CDP).
  const stat = await page.evaluate((TABBABLE) => {
    const d = (e) =>
      `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''} "${(e.innerText || e.getAttribute('alt') || e.querySelector?.('img')?.getAttribute('alt') || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
    const r = { onfocus: [], onchange: [], mouse: [], timers: [] };
    for (const e of document.querySelectorAll('[onfocus],[onblur]')) {
      const h = (e.getAttribute('onfocus') || '') + ' ' + (e.getAttribute('onblur') || '');
      if (/blur\(|location|open\(|submit\(|href\s*=/.test(h)) r.onfocus.push(d(e) + ' ' + h.trim().slice(0, 60));
    }
    for (const e of document.querySelectorAll('[onchange],[oninput],[onkeyup],[onkeydown]')) {
      const h = ['onchange', 'oninput', 'onkeyup', 'onkeydown'].map((a) => e.getAttribute(a) || '').join(' ');
      if (/location|open\(|submit\(|href\s*=|navigate/.test(h)) r.onchange.push(d(e) + ' ' + h.trim().slice(0, 60));
    }
    for (const e of document.querySelectorAll('[onclick],[onmousedown],[onmouseup],[onmouseover],[ondblclick]')) {
      const focusable = e.matches(TABBABLE) || e.closest('a[href],button');
      const keyed = e.hasAttribute('onkeydown') || e.hasAttribute('onkeypress') || e.hasAttribute('onkeyup');
      if (!focusable && !keyed && (e.offsetWidth || e.offsetHeight))
        r.mouse.push(
          d(e) +
            ' role=' +
            (e.getAttribute('role') || '-') +
            (e.querySelector(TABBABLE) ? ' (wraps a focusable child: lower confidence)' : ''),
        );
      else if (
        focusable &&
        e.hasAttribute('onmouseover') &&
        !e.hasAttribute('onfocus') &&
        /src|style|display|visibility/.test(e.getAttribute('onmouseover'))
      )
        r.mouse.push(d(e) + ' onmouseover without onfocus (check hover-only content)');
    }
    for (const s of document.querySelectorAll('script:not([src])'))
      for (const m of s.textContent.matchAll(/setTimeout\s*\(([\s\S]{0,200}?),\s*(\d{4,})\s*\)/g))
        if (Number(m[2]) >= 10000 && /location|expired|logout|sessionStorage\.clear|submit/.test(m[1]))
          r.timers.push(`${m[2]} ms: ${m[1].replace(/\s+/g, ' ').slice(0, 90)}`);
    return r;
  }, TABBABLE);
  // CDP: click listeners added with addEventListener on pointer-looking, non-focusable elements
  try {
    const cdp = await context.newCDPSession(page);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `[...document.querySelectorAll('div,span,li,img,td,p,svg,i')].filter(e=>getComputedStyle(e).cursor==='pointer'&&!e.matches(${JSON.stringify(TABBABLE)})&&!e.closest('a[href],button,label,summary')&&!e.hasAttribute('onclick')&&(e.offsetWidth||e.offsetHeight)).slice(0,300)`,
      returnByValue: false,
    });
    if (result.objectId) {
      const { result: props } = await cdp.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
      for (const p of props.filter((p) => /^\d+$/.test(p.name))) {
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: p.value.objectId });
        if (
          listeners.some((l) => /^(click|mousedown|mouseup|pointerdown|pointerup)$/.test(l.type)) &&
          !listeners.some((l) => /^key/.test(l.type))
        ) {
          const { result: desc } = await cdp.send('Runtime.callFunctionOn', {
            objectId: p.value.objectId,
            functionDeclaration:
              'function(){return this.tagName.toLowerCase()+(this.id?"#"+this.id:"")+" \\""+(this.innerText||"").trim().slice(0,40)+"\\""}',
            returnByValue: true,
          });
          stat.mouse.push(desc.value + ' (addEventListener click, not focusable)');
        }
      }
    }
  } catch (e) {
    out.push('CDP listener scan unavailable: ' + e.message.split('\n')[0]);
  }
  stat.onfocus.forEach((x) => flags.push(`ONFOCUS-HANDLER\t${x}`));
  stat.onchange.forEach((x) => flags.push(`ONCHANGE-NAV?\t${x}\t(3.2.2 candidate; confirm below)`));
  [...new Set(stat.mouse)].forEach((x) => flags.push(`MOUSE-ONLY\t${x}\t(2.1.1/4.1.2 candidate: not keyboard reachable)`));
  stat.timers.forEach((x) => flags.push(`TIMEOUT-SCRIPT?\t${x}\t(2.2.1 candidate: check warning + extend)`));
  // 2. Runtime: focus every tabbable element; did focus stay? did it navigate / open a window?
  g.arm();
  const n = await page.evaluate((T) => {
    window.__cc = [...document.querySelectorAll(T)].filter(
      (e) => !e.disabled && (e.offsetWidth || e.offsetHeight || e.getClientRects().length),
    );
    return window.__cc.length;
  }, TABBABLE);
  let removed = 0;
  for (let i = 0; i < Math.min(n, max); i++) {
    const before = g.navs.length + g.popups.length;
    const r = await page
      .evaluate((i) => {
        const e = window.__cc[i];
        if (!e || !e.isConnected) return null;
        let got = false;
        const h = () => {
          got = true;
        };
        e.addEventListener('focus', h, { once: true, capture: true });
        e.focus();
        e.removeEventListener('focus', h, { capture: true });
        return {
          kept: document.activeElement === e || !got,
          refused: !got,
          desc: `${e.tagName.toLowerCase()} "${(e.innerText || e.getAttribute('aria-label') || e.querySelector('img')?.getAttribute('alt') || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`,
        };
      }, i)
      .catch(() => null);
    await sleep(60);
    if (!r) continue;
    if (!r.kept) {
      removed++;
      if (removed <= 25) flags.push(`FOCUS-REMOVED\t${r.desc}\t(F55: 2.1.1, 2.4.7, 3.2.1)`);
    }
    if (g.navs.length + g.popups.length > before)
      flags.push(`FOCUS-CHANGES-CONTEXT\t${r.desc}\t-> ${[...g.navs, ...g.popups].slice(before).join(' | ')} (3.2.1)`);
  }
  if (removed > 25) flags.push(`FOCUS-REMOVED\t…${removed} elements in total`);
  // 3. Selects: ArrowDown on each; text fields: type one character. Navigation/submit = change of context on input.
  const selects = await page.$$('select');
  for (const [i, s] of selects.entries()) {
    const before = g.navs.length + g.popups.length + (page.blockedWrites.nav || 0);
    const label = await s
      .evaluate((e) => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || e.name || e.id || '').trim().slice(0, 40))
      .catch(() => '');
    await s.focus().catch(() => {});
    await page.keyboard.press('ArrowDown');
    await sleep(800);
    const after = g.navs.length + g.popups.length + (page.blockedWrites.nav || 0);
    flags.push(
      after > before
        ? `CHANGE-ON-INPUT\tselect ${i} "${label}" ArrowDown -> ${[...g.navs, ...g.popups, ...page.blockedWrites].slice(-1)[0]} (3.2.2; aborted, not followed)`
        : `ok\tselect ${i} "${label}" ArrowDown: no change of context`,
    );
  }
  const texts = await page.$$('input[type=text],input:not([type]),input[type=email],input[type=search],input[type=tel],textarea');
  for (const t of texts.slice(0, 30)) {
    const before = g.navs.length + (page.blockedWrites.nav || 0);
    await t.focus().catch(() => {});
    await page.keyboard.type('a').catch(() => {});
    await sleep(300);
    if (g.navs.length + (page.blockedWrites.nav || 0) > before)
      flags.push(
        `CHANGE-ON-INPUT\ttext field ${await t.evaluate((e) => e.name || e.id)} typing -> ${[...g.navs, ...page.blockedWrites].slice(-1)[0]} (3.2.2)`,
      );
    await page.keyboard.press('Backspace').catch(() => {});
  }
  // 4. Optional idle watch for session timeouts (2.2.1)
  if (idle) {
    await page.evaluate(() => {
      window.__dlg = [];
      new MutationObserver(() => {
        for (const d of document.querySelectorAll('[role=alertdialog],[role=dialog],dialog[open],[role=alert]'))
          if ((d.offsetWidth || d.offsetHeight) && !window.__dlg.includes(d)) {
            window.__dlg.push(d);
            window.__dlgT = window.__dlgT || [];
            window.__dlgT.push([Math.round(performance.now() / 1000), (d.innerText || '').trim().slice(0, 80)]);
          }
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    const t0 = Date.now(),
      before = g.navs.length;
    let navAt = null;
    while ((Date.now() - t0) / 1000 < idle) {
      await sleep(1000);
      if (g.navs.length > before && !navAt) {
        navAt = Math.round((Date.now() - t0) / 1000);
        break;
      }
    }
    const dl = await page.evaluate(() => window.__dlgT || []);
    if (navAt)
      flags.push(
        `TIMEOUT-NAV\tpage tried to navigate after ~${navAt}s idle -> ${g.navs.slice(-1)[0]}; warning dialogs seen: ${dl.length ? JSON.stringify(dl) : 'NONE'} (2.2.1${dl.length ? ': check extend control + 20 s' : ' candidate'})`,
      );
    else flags.push(`ok\tno navigation in ${idle}s idle; dialogs: ${dl.length ? JSON.stringify(dl) : 'none'}`);
  }
  g.disarm();
  out.push(...(flags.length ? flags : ['no candidates']));
  if (page.blockedWrites.length) out.push('blocked writes: ' + page.blockedWrites.join(' | '));
  fs.writeFileSync(path.join(dir, `${slug(url)}_${width}.txt`), out.join('\n') + '\n');
  console.log(
    `${url}: ${flags.filter((f) => !f.startsWith('ok')).length} candidates -> ${path.join(dir, slug(url) + '_' + width + '.txt')}`,
  );
  await browser.close();
}
