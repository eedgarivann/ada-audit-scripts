// forms: per field label, placeholder-only, required (and how it is shown), autocomplete purpose (1.3.5), paste blocking (3.3.8),
// split one-time-code boxes, CAPTCHA (1.1.1/3.3.8), controls outside <form>, onchange navigation (3.2.2), ariaSnapshot.
// --try-empty-submit: submits each form EMPTY. POST is blocked by safePage → server-side validation = NOT TESTED.
// GET/script forms: any navigation is aborted and logged (guardNavigation). Then compares before/after to flag
// ERROR-COLOUR-ONLY (1.4.1/3.3.1), ERROR-NOT-ANNOUNCED? (4.1.3), ERROR-NOT-ASSOCIATED? (1.3.1 bp), FOCUS-NOT-MOVED (bp), TITLE-UNCHANGED (bp).
import fs from 'node:fs'; import path from 'node:path';
import { parseArgs, readUrls, safePage, open, clickPrep, outDir, slug, sleep, header, guardNavigation, purposeOf } from './lib.mjs';
const args = parseArgs(); const urls = readUrls(args);
if (!urls.length) { console.error('usage: node forms.mjs --urls ... [--width 390] [--try-empty-submit]'); process.exit(1); }
const width = Number(args.width || 390); const dir = outDir(args, 'forms');
const FIELDS = 'input:not([type=hidden]),select,textarea,button,[role=textbox],[role=combobox],[role=checkbox],[role=radio],[contenteditable=true]';
for (const url of urls) {
  const { browser, page, blockedWrites } = await safePage(args, { width, height: width < 800 ? 844 : 900 });
  const g = await guardNavigation(page);
  await open(page, url); await clickPrep(page, args.click);
  const out = [header('forms', `${url} width=${width}`)];
  const data = await page.evaluate((FIELDS) => {
    const nameOf = el => { const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean); if (ids.length) return ids.map(i => document.getElementById(i)?.innerText || '').join(' ').trim(); if (el.getAttribute('aria-label')) return el.getAttribute('aria-label'); if (el.labels && el.labels.length) return [...el.labels].map(l => l.innerText).join(' ').trim(); if (el.title) return el.title; if (el.type === 'submit' || el.type === 'button') return el.value || el.innerText; if (el.tagName === 'BUTTON') return el.innerText; return ''; };
    const vis = e => { const cs = getComputedStyle(e); return !(cs.display === 'none' || cs.visibility === 'hidden') && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && !e.closest('[aria-hidden=true]'); };
    const groups = [...document.querySelectorAll('form')].map((f, fi) => ({ fi, f })); const outside = [...document.querySelectorAll(FIELDS)].filter(e => !e.closest('form') && !e.closest('[role=search],header,nav') && vis(e));
    if (outside.length) groups.push({ fi: 'outside', f: null, els: outside });
    const shown = l => l.offsetWidth > 2 && l.offsetHeight > 2 && !l.closest('header,nav,[role=search]'); const labelColours = [...document.querySelectorAll('form label')].filter(shown).map(l => getComputedStyle(l).color); const commonColour = labelColours.sort((a, b) => labelColours.filter(x => x === a).length - labelColours.filter(x => x === b).length).pop();
    const res = groups.map(({ fi, f, els }) => ({ fi, action: f?.getAttribute('action') ?? null, method: f ? (f.getAttribute('method') || 'get').toLowerCase() : '-', novalidate: f?.noValidate, fields: (els || [...f.querySelectorAll(FIELDS)]).filter(e => e.type !== 'hidden').map(e => {
      const lab = e.labels?.[0]; const ltxt = nameOf(e).replace(/\s+/g, ' ').slice(0, 80);
      const reqText = /required|\*|\(req|mandatory|obligatoire/i.test((lab?.innerText || '') + (e.getAttribute('aria-describedby') || '').split(' ').map(i => document.getElementById(i)?.innerText || '').join(' '));
      const colourDiff = lab && shown(lab) && commonColour && getComputedStyle(lab).color !== commonColour;
      return { tag: e.tagName.toLowerCase(), type: e.type || e.getAttribute('role') || '', id: e.id, name: e.name, label: ltxt, placeholder: e.placeholder || '', required: e.required || e.getAttribute('aria-required') === 'true', reqText, colourDiff, autocomplete: e.getAttribute('autocomplete') || '', maxlength: e.maxLength, hidden: !vis(e), onpaste: !!e.getAttribute('onpaste') };
    }) }));
    const captcha = [...document.querySelectorAll('img,iframe,div,canvas,p,label')].filter(e => vis(e) && /captcha|recaptcha|hcaptcha|turnstile|are you a robot|prove you are human|characters (you see|in the image)/i.test((e.getAttribute('src') || '') + ' ' + (e.getAttribute('alt') || '') + ' ' + (e.id || '') + ' ' + (typeof e.className === 'string' ? e.className : '') + ' ' + (['P', 'LABEL'].includes(e.tagName) ? e.innerText : ''))).map(e => `${e.tagName.toLowerCase()} ${(e.getAttribute('src') || e.innerText || e.id || '').slice(0, 50)}`);
    const audioAlt = [...document.querySelectorAll('a,button')].some(b => /audio|listen|another way|other (method|option)|call us/i.test(b.innerText + (b.getAttribute('aria-label') || '')));
    return { groups: res, captcha, audioAlt };
  }, FIELDS);
  // paste test: dispatch a synthetic paste on each text-like field and see if it is cancelled
  const pasteBlocked = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]),textarea')].filter(e => e.offsetWidth || e.offsetHeight).filter(e => { const dt = new DataTransfer(); dt.setData('text/plain', '1'); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); e.dispatchEvent(ev); return ev.defaultPrevented; }).map(e => e.id || e.name || e.getAttribute('aria-label') || e.type));
  const flagsAll = [];
  for (const f of data.groups) {
    out.push(`FORM ${f.fi} method=${f.method} action=${f.action}${f.novalidate ? ' novalidate' : ''}${f.fi === 'outside' ? ' (controls outside any <form>)' : ''}`);
    const singles = f.fields.filter(x => x.tag === 'input' && x.maxlength === 1);
    for (const x of f.fields) {
      const flags = []; const isBtn = ['submit', 'button', 'reset', 'image'].includes(x.type) || x.tag === 'button';
      if (!x.label && !isBtn && !x.hidden) flags.push(x.placeholder ? 'PLACEHOLDER-ONLY' : 'NO-LABEL');
      if (x.hidden) flags.push('HIDDEN-CONTROL');
      if (!isBtn && !x.hidden) {
        const purpose = ['checkbox', 'radio', 'search'].includes(x.type) ? null : purposeOf(`${x.label} ${x.placeholder} ${x.name} ${x.id}`);
        if (purpose && (!x.autocomplete || /^(off|on)$/i.test(x.autocomplete)) && !/captcha/i.test(x.label + x.name)) flags.push(`NO-AUTOCOMPLETE(${purpose}; 1.3.5)`);
        if (x.required && !x.reqText) flags.push(x.colourDiff ? 'REQUIRED-COLOUR-ONLY?(1.4.1/3.3.2)' : 'REQUIRED-NOT-SHOWN?(3.3.2: check visible cue)');
        else if (!x.required && x.colourDiff) flags.push('LABEL-COLOUR-DIFFERS?(required shown by colour only? 1.4.1)');
        if (pasteBlocked.includes(x.id || x.name || x.type)) flags.push(/password|otp|code|digit|one-time/i.test(x.type + x.label + x.name + x.autocomplete) ? 'PASTE-BLOCKED(3.3.8: blocks password managers/copying)' : 'PASTE-BLOCKED(bp)');
      }
      out.push(`  ${x.tag}[${x.type}] id=${x.id} name=${x.name} label="${x.label}" placeholder="${x.placeholder}" required=${x.required} autocomplete="${x.autocomplete}" ${flags.join(' ')}`);
      flags.filter(fl => fl !== 'HIDDEN-CONTROL').forEach(fl => flagsAll.push(`${fl} ${x.id || x.name}`));
    }
    if (singles.length >= 4) { out.push(`  SPLIT-CODE? ${singles.length} single-character boxes (check paste works and the group has one label; 3.3.8)`); flagsAll.push('SPLIT-CODE?'); }
  }
  if (!data.groups.length) out.push('no <form> elements or standalone controls');
  if (data.captcha.length) { const fl = `CAPTCHA ${data.captcha.slice(0, 3).join(' | ')}; alternative method/modality offered: ${data.audioAlt ? 'maybe (check it)' : 'NONE FOUND'} (1.1.1 needs an alternative modality; 3.3.8 needs a non-cognitive-test method)`; out.push(fl); flagsAll.push(fl); }
  const first = page.locator('form').first();
  if (await first.count()) out.push('ariaSnapshot(form 0):\n' + await first.ariaSnapshot().catch(e => 'ERR ' + e.message));
  if (args['try-empty-submit']) {
    g.arm();
    for (const f of data.groups.filter(x => x.fi !== 'outside')) {
      const bw = blockedWrites.length, nv = g.navs.length;
      const before = await page.evaluate(fi => {
        const form = document.querySelectorAll('form')[fi];
        window.__added = []; window.__mo?.disconnect(); window.__mo = new MutationObserver(ms => { for (const m of ms) { const nodes = m.type === 'childList' ? [...m.addedNodes] : [m.target]; for (const n of nodes) { const e = n.nodeType === 1 ? n : n.parentElement; if (e && (e.innerText || '').trim()) window.__added.push(e); } } });
        window.__mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
        const st = [...form.querySelectorAll('input:not([type=hidden]),select,textarea')].map(e => { const cs = getComputedStyle(e); return [e.id || e.name, cs.borderColor + cs.outlineColor + cs.backgroundColor, e.getAttribute('aria-invalid')]; });
        form.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]),textarea').forEach(e => { e.value = ''; });
        const btn = form.querySelector('button:not([type=button]):not([type=reset]),input[type=submit],input[type=image]');
        (btn || form).focus?.();
        return { st, title: document.title };
      }, f.fi);
      // press the real submit button by keyboard if there is one (closer to a user), else requestSubmit
      const pressed = await page.evaluate(fi => { const b = document.querySelectorAll('form')[fi].querySelector('button:not([type=button]):not([type=reset]),input[type=submit]'); if (b) { b.focus(); return true; } return false; }, f.fi);
      if (pressed) await page.keyboard.press('Enter'); else await page.evaluate(fi => { const fm = document.querySelectorAll('form')[fi]; fm.requestSubmit ? fm.requestSubmit() : fm.submit(); }, f.fi);
      await sleep(1500);
      if (blockedWrites.length > bw) { out.push(`FORM ${f.fi}: blocked write ${blockedWrites.slice(bw).join(' | ')} → server-side validation; error handling NOT TESTED (core rule 3: staging/test entry only)`); flagsAll.push(`SERVER-SIDE-NOT-TESTED form ${f.fi}`); continue; }
      const after = await page.evaluate(({ fi, st }) => {
        window.__mo?.disconnect();
        const form = document.querySelectorAll('form')[fi]; const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
        const fields = [...form.querySelectorAll('input:not([type=hidden]),select,textarea')];
        const added = [...new Set(window.__added)].filter(e => vis(e) && !e.matches('input,select,textarea') && !form.querySelector('button')?.contains(e)).filter((e, i, a) => !a.some(o => o !== e && o.contains(e)));
        const live = e => !!e.closest('[aria-live]:not([aria-live=off]),[role=alert],[role=status],[role=alertdialog]');
        const a = document.activeElement; const focusDesc = a === document.body || !a ? 'body' : `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}`;
        const focusInError = added.some(e => e.contains(a) || e === a) || (a && a.getAttribute?.('aria-invalid') === 'true');
        const described = new Set(fields.flatMap(e => [...(e.getAttribute('aria-describedby') || '').split(/\s+/), e.getAttribute('aria-errormessage') || '']).filter(Boolean).map(i => document.getElementById(i)).filter(Boolean));
        const perField = fields.filter(e => !/^(submit|button|image|reset)$/.test(e.type) && e !== document.activeElement && (e.id || e.name)).map(e => { const cs = getComputedStyle(e); const s0 = st.find(s => s[0] === (e.id || e.name)); return { id: e.id || e.name, styleChanged: s0 && s0[1] !== cs.borderColor + cs.outlineColor + cs.backgroundColor, invalid: e.getAttribute('aria-invalid') === 'true' || e.matches(':invalid'), nativeMsg: e.validationMessage, describedText: [...described].filter(d => (e.getAttribute('aria-describedby') || '').includes(d.id)).map(d => d.innerText.trim()).join(' ') }; });
        return { added: added.map(e => ({ text: e.innerText.trim().replace(/\s+/g, ' ').slice(0, 80), live: live(e), assoc: [...described].some(d => d.contains(e) || e.contains(d)), tag: e.tagName.toLowerCase() })), focus: focusDesc, focusInError, title: document.title, perField, native: !form.noValidate && fields.some(e => e.matches(':invalid')) };
      }, { fi: f.fi, st: before.st });
      const navd = g.navs.length > nv ? g.navs.slice(nv).join(' | ') : '';
      out.push(`FORM ${f.fi} empty submit (client side${navd ? '; navigation aborted: ' + navd : ''}): focus→${after.focus}; new text: ${JSON.stringify(after.added)}`);
      const errsText = after.added.filter(x => x.text);
      const changed = after.perField.filter(p => p.styleChanged);
      if (navd && !errsText.length) { out.push('  NO-CLIENT-VALIDATION (form navigates with empty fields; check server/next step)'); }
      if (after.native && !errsText.length) out.push(`  native browser validation: ${after.perField.filter(p => p.nativeMsg).map(p => p.id + ': ' + p.nativeMsg).join('; ')} (generally announced; check custom styling)`);
      else {
        const colourOnly = navd ? [] : changed.filter(p => !p.describedText && !errsText.length && p.invalid !== undefined);
        if (colourOnly.length) { const fl = `ERROR-COLOUR-ONLY (1.4.1/3.3.1): ${colourOnly.map(p => p.id).join(', ')} changed style; no error text appeared`; out.push('  ' + fl); flagsAll.push(fl); }
        if (errsText.length && !errsText.some(x => x.live) && !after.focusInError) { const fl = `ERROR-NOT-ANNOUNCED? (4.1.3): ${errsText.length} new error text(s) not in a live region/role=alert and focus did not move to them`; out.push('  ' + fl); flagsAll.push(fl); }
        if (errsText.length && !errsText.some(x => x.assoc) && !after.perField.some(p => p.describedText)) { const fl = 'ERROR-NOT-ASSOCIATED? (1.3.1/3.3.1 bp): error text not linked to fields (aria-describedby/errormessage)'; out.push('  ' + fl); flagsAll.push(fl); }
        if ((errsText.length || changed.length) && !after.focusInError) { const fl = `FOCUS-NOT-MOVED (bp): focus stayed on ${after.focus}, not on an error summary or first invalid field`; out.push('  ' + fl); flagsAll.push(fl); }
        if ((errsText.length || changed.length) && after.title === before.title) out.push('  TITLE-UNCHANGED (bp: prefix "Error:" when errors show)');
        if (!errsText.length && !changed.length && !navd) out.push('  no visible reaction to empty submit (check manually)');
      }
      await page.goto(url).catch(() => {}); await sleep(800); // reset state (GET)
    }
    g.disarm();
  }
  out.push('SUMMARY ' + (flagsAll.length ? flagsAll.join(' || ') : 'no candidates'));
  fs.writeFileSync(path.join(dir, `${slug(url)}_${width}.txt`), out.join('\n') + '\n');
  console.log(`${url}: ${flagsAll.length} candidates`);
  await browser.close();
}
