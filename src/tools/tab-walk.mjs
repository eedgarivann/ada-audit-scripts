// tab-walk: Tab (or Shift+Tab) through page; flags NO-RING?, COVERED, PARTLY-COVERED, OFFSCREEN, TEXT n:1, REPEAT(trap?)
import fs from 'node:fs';
import path from 'node:path';
import {
  BODY_STATE,
  trackFocus,
  parseArgs,
  readUrls,
  safePage,
  open,
  clickPrep,
  outDir,
  slug,
  sleep,
  contrast,
  DESCRIBE_FOCUS,
  header,
} from '../core/lib.mjs';
const args = parseArgs();
const urls = readUrls(args);
if (!urls.length) {
  console.error('usage: node tab-walk.mjs --urls ... [--width 390] [--max 60] [--settle 1000] [--shift]');
  process.exit(1);
}
const width = Number(args.width || 1440),
  max = Number(args.max || 60),
  settle = Number(args.settle || 1000),
  shift = !!args.shift;
const dir = outDir(args, 'tab-walk');
for (const url of urls) {
  const { browser, page, blockedWrites } = await safePage(args, { width, height: width < 800 ? 844 : 900 });
  await open(page, url);
  await clickPrep(page, args.click);
  const key = shift ? 'Shift+Tab' : 'Tab';
  await trackFocus(page);
  const lines = [header('tab-walk', `${url} width=${width} ${key}`)];
  const seen = new Map();
  let consecutive = 0,
    last = '',
    firstId = null,
    sawEnd = false;
  const base = path.join(dir, `${slug(url)}_${width}${shift ? '_shift' : ''}`);
  fs.mkdirSync(base, { recursive: true });
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(key);
    await sleep(settle);
    const f = await page.evaluate(DESCRIBE_FOCUS);
    if (f.none) {
      // builder addition: appendix lists no tab-walk flag for focus dropping to <body>
      consecutive = last === 'BODY' ? consecutive + 1 : 1;
      last = 'BODY';
      const bs = await page.evaluate(BODY_STATE);
      if (bs.endOfOrder) sawEnd = true;
      lines.push(
        bs.endOfOrder
          ? `${i}\t(body)\tEND-OF-TAB-ORDER (wraps; not a finding)`
          : `${i}\t(body)\tFOCUS-LOST after ${bs.lastTag}${bs.lastBlurredByScript ? ' (onfocus=blur)' : ''} (2.4.7/2.1.1 candidate)`,
      );
      if (consecutive >= 10) {
        lines.push('HALT: focus on <body> 10x (onfocus=blur or no more stops?)');
        break;
      }
      continue;
    }
    const id = `${f.tag}|${f.name}|${f.href || ''}|${f.rect.x},${f.rect.y}`;
    // v4.2: the first stop after END-OF-TAB-ORDER is the wrap (viewport rects differ once the page has scrolled)
    if (i === 1) firstId = id;
    else if ((id === firstId && last !== id) || (sawEnd && last === 'BODY')) {
      lines.push(`${i}\tWRAPPED to first stop: walk complete`);
      break;
    }
    const flags = [];
    if (f.ring === 'NONE') flags.push('NO-RING?');
    if (!f.inView) flags.push('OFFSCREEN');
    if (f.covered === 5) flags.push('COVERED(entire?)');
    else if (f.covered > 0) flags.push(`PARTLY-COVERED(${f.covered}/5)`);
    const c = contrast(f.fg, f.bg);
    if (c && c < 4.5) flags.push(`TEXT ${c}:1`);
    seen.set(id, (seen.get(id) || 0) + 1);
    consecutive = id === last ? consecutive + 1 : 1;
    last = id;
    if (consecutive >= 3) flags.push('REPEAT(trap?)');
    lines.push(
      `${i}\t${f.role}\t"${f.name}"\t${f.href || ''}\tring=${f.ring}\t${flags.join(' ')}${f.coverers.length ? ' by ' + f.coverers.join(',') : ''}`,
    );
    if (flags.length && f.inView && f.rect.w > 0) {
      const clip = {
        x: Math.max(0, f.rect.x - 20),
        y: Math.max(0, f.rect.y - 20),
        width: Math.min(width, f.rect.w + 40),
        height: f.rect.h + 40,
      };
      await page.screenshot({ path: path.join(base, `${String(i).padStart(2, '0')}.png`), clip }).catch(() => {});
    }
    if (consecutive >= 10) {
      lines.push('HALT: same element 10x (trap?)');
      break;
    }
  }
  if (blockedWrites.length) lines.push('blocked writes: ' + blockedWrites.join(' | '));
  fs.writeFileSync(base + '.tsv', lines.join('\n') + '\n');
  console.log(
    `${url} ${width} ${key}: ${lines.filter((l) => /NO-RING|COVERED|OFFSCREEN|TEXT |REPEAT|FOCUS-LOST/.test(l)).length} flagged stops -> ${base}.tsv`,
  );
  await browser.close();
}
