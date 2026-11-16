// reflow: 320/640 px horizontal overflow (ignore hidden/carousels); 1.4.12 text-spacing at 1280, list clipped
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readUrls, safePage, open, outDir, slug, sleep, header } from '../core/lib.mjs';
const args = parseArgs();
const urls = readUrls(args);
if (!urls.length) {
  console.error('usage: node reflow.mjs --urls ...');
  process.exit(1);
}
const dir = outDir(args, 'reflow');
for (const url of urls) {
  const out = [header('reflow', url)];
  for (const w of [320, 640]) {
    const { browser, page } = await safePage(args, { width: w, height: 800 });
    await open(page, url);
    const r = await page.evaluate((vw) => {
      const docW = document.documentElement.scrollWidth;
      const offenders = [];
      for (const e of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (e.closest('[class*=carousel],[class*=slider],[class*=swiper],[aria-roledescription=carousel],table,pre,video,iframe,map'))
          continue;
        const b = e.getBoundingClientRect();
        if (b.right > vw + 1 && b.width > 0)
          offenders.push(
            `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : ''} right=${Math.round(b.right)}`,
          );
      }
      return { docW, offenders: offenders.slice(0, 15), count: offenders.length };
    }, w);
    out.push(`${w}px: scrollWidth=${r.docW} ${r.docW > w + 1 ? 'H-OVERFLOW (1.4.10 candidate at 320)' : 'ok'} offenders=${r.count}`);
    r.offenders.forEach((o) => out.push('   ' + o));
    await page.screenshot({ path: path.join(dir, `${slug(url)}_${w}.png`), fullPage: true });
    await browser.close();
  }
  const { browser, page } = await safePage(args, { width: 1280, height: 900 });
  await open(page, url);
  await page.addStyleTag({
    content: '*{line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important}p{margin-bottom:2em!important}',
  });
  await sleep(800);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((e) => {
        const cs = getComputedStyle(e);
        const bb = e.getBoundingClientRect();
        if (bb.width <= 2 || bb.height <= 2 || /rect\(0/.test(cs.clip) || cs.clipPath.includes('inset(50%')) return false;
        return (
          (cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.overflowX === 'hidden') &&
          (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2) &&
          e.innerText?.trim()
        );
      })
      .slice(0, 20)
      .map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} "${e.innerText.trim().slice(0, 40)}"`),
  );
  out.push(`1.4.12 spacing @1280: ${clipped.length} clipped candidates`);
  clipped.forEach((c) => out.push('   ' + c));
  await page.screenshot({ path: path.join(dir, `${slug(url)}_spacing.png`), fullPage: true });
  await browser.close();
  fs.writeFileSync(path.join(dir, `${slug(url)}.txt`), out.join('\n') + '\n');
  console.log(out.join('\n'));
}
