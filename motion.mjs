// motion: reducedMotion no-preference vs reduce; moving elements (>3px), video autoplay/controls, infinite animations, pause controls
import fs from 'node:fs'; import path from 'node:path';
import { parseArgs, readUrls, safePage, open, outDir, slug, sleep, header } from './lib.mjs';
const args = parseArgs(); const urls = readUrls(args);
if (!urls.length) { console.error('usage: node motion.mjs --urls ... [--width 390]'); process.exit(1); }
const width = Number(args.width || 390); const dir = outDir(args, 'motion');
const snap = page => page.evaluate(() => [...document.querySelectorAll('body *')].slice(0, 4000).map((e, i) => { const b = e.getBoundingClientRect(); return [i, Math.round(b.x), Math.round(b.y)]; }));
for (const url of urls) {
  const out = [header('motion', `${url} width=${width}`)];
  for (const rm of ['no-preference', 'reduce']) {
    const { browser, page } = await safePage(args, { width, height: width < 800 ? 844 : 900 }, { reducedMotion: rm });
    await open(page, url);
    const a = await snap(page); await sleep(3000); const b = await snap(page);
    const moved = a.filter((p, i) => b[i] && (Math.abs(p[1] - b[i][1]) > 3 || Math.abs(p[2] - b[i][2]) > 3)).length;
    const info = await page.evaluate(() => ({
      videos: [...document.querySelectorAll('video')].map(v => ({ autoplay: v.autoplay, muted: v.muted, controls: v.controls, loop: v.loop, paused: v.paused })),
      infinite: document.getAnimations().filter(an => an.effect?.getTiming?.().iterations === Infinity).map(an => an.animationName || an.constructor.name).slice(0, 10),
      marqueeBlink: document.querySelectorAll('marquee,blink').length,
      gifs: [...document.images].filter(i => /\.gif(\?|$)/i.test(i.src)).length,
      pauseControls: [...document.querySelectorAll('button,a,[role=button]')].filter(e => /pause|stop/i.test(e.innerText + ' ' + (e.getAttribute('aria-label') || ''))).length,
    }));
    out.push(`${rm}: movedElements(>3px in 3s)=${moved} infiniteAnimations=${JSON.stringify(info.infinite)} marquee/blink=${info.marqueeBlink} gifs=${info.gifs} videos=${JSON.stringify(info.videos)} pauseControls=${info.pauseControls}`);
    await browser.close();
  }
  out.push('Note: animated GIFs and canvas motion are not detected by DOM position; check visually (2.2.2).');
  fs.writeFileSync(path.join(dir, `${slug(url)}_${width}.txt`), out.join('\n') + '\n');
  console.log(out.join('\n'));
}
