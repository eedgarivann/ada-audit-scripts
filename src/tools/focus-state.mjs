// focus-state: settled default/hover/focus colours + contrast + shots for given stops/selectors
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readUrls, safePage, open, clickPrep, outDir, slug, sleep, contrast, header } from '../core/lib.mjs';
const args = parseArgs();
const urls = readUrls(args);
if (!urls.length || !(args.selector || args.stops)) {
  console.error('usage: node focus-state.mjs --urls ... (--selector "css;css" | --stops 3,7) [--width]');
  process.exit(1);
}
const width = Number(args.width || 1440);
const dir = outDir(args, 'focus-state');
const read = (el) =>
  el.evaluate((e) => {
    const cs = getComputedStyle(e);
    let b = e,
      bg;
    while (b) {
      const c = getComputedStyle(b).backgroundColor;
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) {
        bg = c;
        break;
      }
      b = b.parentElement;
    }
    return {
      fg: cs.color,
      bg: bg || 'rgb(255, 255, 255)',
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      shadow: cs.boxShadow,
      textDecoration: cs.textDecorationLine,
    };
  });
for (const url of urls) {
  const { browser, page } = await safePage(args, { width, height: width < 800 ? 844 : 900 });
  await open(page, url);
  await clickPrep(page, args.click);
  const out = [header('focus-state', `${url} width=${width}`)];
  const targets = [];
  if (args.selector)
    for (const s of String(args.selector).split(';').filter(Boolean)) targets.push({ label: s, get: async () => page.$(s) });
  if (args.stops)
    for (const n of String(args.stops).split(',').map(Number))
      targets.push({
        label: `tab#${n}`,
        get: async () => {
          await page.evaluate(() => {
            document.activeElement?.blur();
            window.scrollTo(0, 0);
          });
          await page
            .locator('body')
            .focus()
            .catch(() => {});
          for (let i = 0; i < n; i++) await page.keyboard.press('Tab');
          return page.evaluateHandle(() => document.activeElement);
        },
      });
  let k = 0;
  for (const t of targets) {
    const el = await t.get();
    if (!el || !(await el.asElement())) {
      out.push(`${t.label}\tMISSING`);
      continue;
    }
    const e = el.asElement();
    await page.mouse.move(0, 0);
    await sleep(300);
    const def = await read(e);
    await e.hover().catch(() => {});
    await sleep(1000);
    const hov = await read(e);
    await page.mouse.move(0, 0);
    await e.focus();
    await sleep(1000);
    const foc = await read(e);
    const base = path.join(dir, `${slug(url)}_${width}_${k++}`);
    await e.screenshot({ path: base + '.png' }).catch(() => {});
    for (const [st, v] of [
      ['default', def],
      ['hover', hov],
      ['focus', foc],
    ])
      out.push(`${t.label}\t${st}\tfg=${v.fg}\tbg=${v.bg}\t${contrast(v.fg, v.bg)}:1\toutline=${v.outline}\tshadow=${v.shadow}`);
    if (def.outline === foc.outline && def.shadow === foc.shadow && def.fg === foc.fg && def.bg === foc.bg)
      out.push(`${t.label}\tNO-VISIBLE-FOCUS-CHANGE? (2.4.7 candidate)`);
  }
  fs.writeFileSync(path.join(dir, `${slug(url)}_${width}.tsv`), out.join('\n') + '\n');
  console.log(out.slice(1).join('\n'));
  await browser.close();
}
