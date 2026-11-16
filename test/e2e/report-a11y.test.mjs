// The HTML report must itself be accessible: run axe-core (WCAG 2.2 A/AA + best practice) on the sample report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('sample report.html has no axe violations at 320 and 1280 px (reflow), and is keyboard reachable', async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [320, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.goto(pathToFileURL(path.join(root, 'docs/sample-report/report.html')).href);
      const r = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      assert.deepEqual(
        r.violations.map((v) => `${v.id}: ${v.nodes.length}`),
        [],
        `axe violations at ${width}px`,
      );
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, `no horizontal scroll at ${width}px`);
      await page.keyboard.press('Tab');
      assert.match(await page.evaluate(() => document.activeElement.textContent), /skip/i, 'first Tab stop is the skip link');
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
