// axe-scan: axe-core at each width; JSON per URL/width, viewport shot, summary.tsv
import fs from 'node:fs';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { parseArgs, readUrls, safePage, open, scrollThrough, clickPrep, outDir, slug, header } from '../core/lib.mjs';
const args = parseArgs();
const urls = readUrls(args);
if (!urls.length) {
  console.error('usage: node axe-scan.mjs --urls urls.txt|a,b [--widths 390,1440] [--click "sel;sel"] [--out dir]');
  process.exit(1);
}
const widths = String(args.widths || '390,1440')
  .split(',')
  .map(Number);
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const dir = outDir(args, 'axe');
const rows = [['url', 'width', 'rule', 'impact', 'tags', 'nodes', 'help', 'firstTarget'].join('\t')];
let axeVersion = '';
for (const w of widths) {
  const { browser, page, blockedWrites } = await safePage(args, { width: w, height: w < 800 ? 844 : 900 });
  for (const url of urls) {
    await open(page, url);
    await scrollThrough(page);
    const clicks = await clickPrep(page, args.click);
    const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    axeVersion = res.testEngine.version;
    const base = path.join(dir, `${slug(url)}_${w}`);
    fs.writeFileSync(
      base + '.json',
      JSON.stringify(
        {
          url,
          width: w,
          axe: axeVersion,
          clicks,
          blockedWrites: [...blockedWrites],
          violations: res.violations,
          incomplete: res.incomplete.map((i) => ({ id: i.id, impact: i.impact, nodes: i.nodes.length, help: i.help })),
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: base + '.png' });
    for (const v of res.violations)
      rows.push(
        [
          url,
          w,
          v.id,
          v.impact,
          v.tags.filter((t) => /^wcag|best/.test(t)).join(','),
          v.nodes.length,
          v.help,
          (v.nodes[0]?.target || []).join(' '),
        ].join('\t'),
      );
    console.log(
      `${w}px ${url}: ${res.violations.length} rules violated, ${res.violations.reduce((a, v) => a + v.nodes.length, 0)} nodes; incomplete ${res.incomplete.length}`,
    );
  }
  await browser.close();
}
fs.writeFileSync(path.join(dir, 'summary.tsv'), header('axe-scan', `axe-core ${axeVersion}`) + rows.join('\n') + '\n');
console.log(`axe-core ${axeVersion}; summary -> ${path.join(dir, 'summary.tsv')}`);
