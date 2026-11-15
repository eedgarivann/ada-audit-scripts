// menu-modal: open trigger by Enter, focus inside?, Tab 25x counting escapes, Esc, focus return, aria-expanded, shots
import fs from 'node:fs'; import path from 'node:path';
import { parseArgs, readUrls, safePage, open, clickPrep, outDir, slug, sleep, header } from './lib.mjs';
const args = parseArgs(); const urls = readUrls(args);
if (!urls.length || !args.trigger) { console.error('usage: node menu-modal.mjs --urls ... --trigger "css" [--container "css"] [--width 390] [--modal]'); process.exit(1); }
const width = Number(args.width || 390); const dir = outDir(args, 'menu-modal');
for (const url of urls) {
  const { browser, page } = await safePage(args, { width, height: width < 800 ? 844 : 900 });
  await open(page, url); await clickPrep(page, args.click);
  const out = [header('menu-modal', `${url} width=${width} trigger=${args.trigger} container=${args.container || '(auto)'}`)];
  const trig = await page.$(args.trigger);
  if (!trig) { out.push('TRIGGER MISSING'); }
  else {
    const isSubmit = await trig.evaluate(e => (e.type || '').toLowerCase() === 'submit' && !!e.form);
    if (isSubmit) { out.push('REFUSED: trigger is a submit control'); }
    else {
      const base = path.join(dir, `${slug(url)}_${width}`);
      out.push(`aria-expanded before: ${await trig.getAttribute('aria-expanded')}`);
      const openTrig = async () => { const ok = await trig.evaluate(e => { e.focus(); return document.activeElement === e; }).catch(() => false); if (ok) await page.keyboard.press('Enter'); else { out.push('  (trigger not focusable: opened by mouse click for the remaining checks)'); await trig.click().catch(() => {}); } };
      // v4: is the trigger keyboard-operable at all? (2.1.1, 4.1.2)
      const kb = await trig.evaluate(e => { e.focus(); const cs = getComputedStyle(e); return { focused: document.activeElement === e, tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '', tabindex: e.getAttribute('tabindex'), name: (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 40), display: cs.display }; });
      if (!kb.focused) out.push(`TRIGGER-NOT-FOCUSABLE (2.1.1): ${kb.tag}${kb.role ? '[role=' + kb.role + ']' : ''} "${kb.name}" cannot take keyboard focus`);
      if (!/^(button|a|summary|input)$/.test(kb.tag) && !/button|link|menuitem|tab/.test(kb.role)) out.push(`TRIGGER-NO-ROLE (4.1.2): ${kb.tag} has no button role/state`);
      const vis0 = async () => cont0 ? page.evaluate(c => { const b = document.querySelector(c); return b ? !!(b.offsetWidth || b.offsetHeight) : null; }, cont0) : null;
      const cont0 = args.container || null;
      if (cont0) {
        const v0 = await vis0(); if (kb.focused) { await page.keyboard.press('Enter'); await sleep(600); } const vEnter = await vis0();
        if (vEnter !== v0) { await trig.focus().catch(() => {}); await page.keyboard.press('Enter'); await sleep(400); }
        if (kb.focused) { await page.keyboard.press(' '); await sleep(600); } const vSpace = await vis0(); if (vSpace !== v0) { await page.keyboard.press(' '); await sleep(400); }
        await trig.click().catch(() => {}); await sleep(600); const vClick = await vis0(); if (vClick !== v0) { await trig.click().catch(() => {}); await sleep(400); }
        out.push(`opens by: Enter=${vEnter !== v0} Space=${vSpace !== v0} click=${vClick !== v0}`);
        if (vClick !== v0 && (vEnter === v0 || vSpace === v0)) out.push(`CLICK-ONLY-TRIGGER? (2.1.1): opens on click but not on ${[vEnter === v0 ? 'Enter' : '', vSpace === v0 ? 'Space' : ''].filter(Boolean).join('/')}${kb.tag === 'a' && vEnter !== v0 ? ' (links need Enter only)' : ''}`);
      }
      await openTrig(); await sleep(1000);
      await page.screenshot({ path: base + '_open.png' });
      out.push(`aria-expanded after Enter: ${await trig.getAttribute('aria-expanded')}`);
      const cont = args.container || (await trig.getAttribute('aria-controls') ? '#' + await trig.getAttribute('aria-controls') : null);
      const inside = async () => page.evaluate(c => { const a = document.activeElement; const box = c ? document.querySelector(c) : null; return { tag: a?.tagName, name: (a?.innerText || a?.getAttribute('aria-label') || '').slice(0, 60), inside: box ? box.contains(a) : null, visible: box ? !!(box.offsetWidth || box.offsetHeight) : null }; }, cont);
      const f0 = await inside(); out.push(`after open: focus=${f0.tag} "${f0.name}" inside=${f0.inside} containerVisible=${f0.visible}`);
      let escapes = 0;
      for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); await sleep(150); const f = await inside(); if (f.inside === false) escapes++; }
      out.push(`Tab x25: escapes=${escapes}${args.modal && escapes ? '  MODAL-FOCUS-ESCAPES (2.4.3 candidate)' : ''}`);
      const stillOpen = cont ? await page.evaluate(c => { const b = document.querySelector(c); return b ? !!(b.offsetWidth || b.offsetHeight) : false; }, cont) : false;
      if (!stillOpen) { await openTrig(); await sleep(800); } // v4 fix: re-pressing a toggle closed it, so Esc looked like it worked
      else await trig.evaluate(e => e.focus()).catch(() => {});
      await page.keyboard.press('Escape'); await sleep(1000);
      const f1 = await inside(); const onTrig = await trig.evaluate(e => e === document.activeElement);
      out.push(`after Esc: containerVisible=${f1.visible} focusOnTrigger=${onTrig} aria-expanded=${await trig.getAttribute('aria-expanded')}`);
      if (f1.visible) out.push('ESC-DID-NOT-CLOSE? (re-run before reporting)');
      if (!onTrig) out.push('FOCUS-NOT-RETURNED? (re-run before reporting)');
      await page.screenshot({ path: base + '_esc.png' });
    }
  }
  fs.writeFileSync(path.join(dir, `${slug(url)}_${width}.txt`), out.join('\n') + '\n');
  console.log(out.join('\n'));
  await browser.close();
}
