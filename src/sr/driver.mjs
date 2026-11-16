// Real screen-reader driver: runs NVDA (Windows) or VoiceOver (macOS) through Guidepup against a headed
// Playwright browser, walks a journey's passes and records every spoken phrase. Read-only: passes move the
// screen-reader cursor or press Tab; nothing is activated, typed or submitted, and non-GET requests are blocked.
// Web-content focusing follows @guidepup/playwright 0.21 (MIT, https://github.com/guidepup/guidepup-playwright).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PASS_LABEL } from './journey.mjs';
import { slug } from '../core/lib.mjs';

const require = createRequire(import.meta.url);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const ALLOWED = new Set(['GET', 'HEAD', 'OPTIONS']);
export const TRANSCRIPT_SCHEMA = 'ada-real-sr/1';

const APP_NAME = {
  chromium: 'Google Chrome For Testing',
  chrome: 'Google Chrome',
  msedge: 'Microsoft Edge',
  firefox: 'Nightly',
  webkit: 'Playwright',
};
const APP_ID = {
  chromium: 'com.google.chrome.for.testing',
  chrome: 'com.google.Chrome',
  msedge: 'com.microsoft.edgemac',
  firefox: 'org.mozilla.nightlyunofficial',
  webkit: 'org.webkit.Playwright',
};

export class SrEnvironmentError extends Error {
  name = 'SrEnvironmentError';
}

/** Which screen reader this machine can run. */
export function resolveScreenReader(want = 'auto', platform = process.platform) {
  const sr = want === 'auto' ? (platform === 'win32' ? 'nvda' : platform === 'darwin' ? 'voiceover' : null) : want;
  if (!sr)
    throw new SrEnvironmentError(
      'real screen readers need Windows (NVDA) or macOS (VoiceOver). On Linux, run the "Real screen readers" GitHub workflow (docs/real-screen-reader.md).',
    );
  if (!['nvda', 'voiceover'].includes(sr)) throw new SrEnvironmentError(`--sr must be nvda, voiceover or auto (got "${sr}")`);
  if (sr === 'nvda' && platform !== 'win32') throw new SrEnvironmentError('NVDA runs only on Windows');
  if (sr === 'voiceover' && platform !== 'darwin') throw new SrEnvironmentError('VoiceOver runs only on macOS');
  return sr;
}

function guidepupVersion() {
  try {
    return require('@guidepup/guidepup/package.json').version;
  } catch {
    return null;
  }
}
function nvdaVersion() {
  try {
    const m = require('@guidepup/guidepup/manifest.json');
    const a = m.screenReaders.find((s) => s.id === 'nvda').assets.at(-1);
    return a.version.split('-').pop();
  } catch {
    return null;
  }
}
function macVersion() {
  try {
    return execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Snapshot of the focused element: enough to name it in a finding and to know whether it has a real label. */
const FOCUS_INFO = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { none: true, url: location.href };
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const sel = (e) => {
    if (e.id) return e.tagName.toLowerCase() + '#' + esc(e.id);
    const parts = [];
    for (let n = e; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      let p = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(p + '#' + esc(n.id)); break; }
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(n) + 1) + ')';
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const tag = el.tagName.toLowerCase();
  const labelled = !!(el.getAttribute('aria-label') || '').trim() ||
    !!(el.getAttribute('aria-labelledby') || '').split(/\\s+/).some((id) => id && (document.getElementById(id)?.textContent || '').trim()) ||
    !!(el.labels && [...el.labels].some((l) => l.textContent.trim())) ||
    !!(el.getAttribute('title') || '').trim();
  const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('alt') || el.getAttribute('title') ||
    (el.querySelector && el.querySelector('img[alt]') ? el.querySelector('img[alt]').alt : '') || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
  return { tag, type: el.getAttribute('type') || null, role: el.getAttribute('role') || null, id: el.id || null, selector: sel(el),
    name, hasLabel: /^(input|select|textarea)$/.test(tag) ? labelled : null, placeholder: el.getAttribute('placeholder') || null,
    invalid: el.getAttribute('aria-invalid') === 'true', href: el.href || null, url: location.href };
})()`;

async function readOnlyContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const blocked = [];
  await context.route('**/*', (route) => {
    const m = route.request().method().toUpperCase();
    if (!ALLOWED.has(m)) {
      blocked.push(`${m} ${route.request().url()}`);
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });
  return { context, blocked };
}

/** Screen-reader specific commands, behind one small interface. */
function adapterFor(name, gp) {
  if (name === 'nvda') {
    const sr = gp.nvda;
    const K = gp.NVDAKeyCodeCommands;
    const top = { keyCode: [gp.WindowsKeyCodes.Home], modifiers: [gp.WindowsModifiers.Control] };
    const altEsc = { keyCode: [gp.WindowsKeyCodes.Escape], modifiers: [gp.WindowsModifiers.Alt] };
    const norm = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    return {
      sr,
      label: 'NVDA',
      version: nvdaVersion(),
      cmd: {
        headings: () => sr.perform(K.moveToNextHeading),
        landmarks: () => sr.perform(K.moveToNextLandmark),
        formFields: () => sr.perform(K.moveToNextFormField),
        buttons: () => sr.perform(K.moveToNextButton),
        links: () => sr.perform(K.moveToNextLink),
        graphics: () => sr.perform(K.moveToNextGraphic),
        tab: () => sr.press('Tab'),
      },
      async focusWeb(page, browserName) {
        await sr.perform(K.exitFocusMode, { capture: false });
        const app = norm(APP_NAME[browserName] || browserName);
        const title = norm(await page.title());
        const ok = (w) => (title && norm(w).startsWith(title)) || norm(w).includes(app);
        await sr.perform(K.reportTitle);
        let w = await sr.lastSpokenPhrase();
        for (let i = 0; i < 10 && !ok(w); i++) {
          await sr.perform(altEsc, { capture: false });
          await delay(500);
          await sr.perform(K.reportTitle);
          w = await sr.lastSpokenPhrase();
        }
        if (!ok(w)) throw new Error(`NVDA could not focus the browser window (last title: "${w}")`);
        await page.bringToFront();
        await page.locator('body').focus();
        await page
          .locator('body')
          .click({ position: { x: 1, y: 1 } })
          .catch(() => {});
        await page.locator('body').blur();
        await sr.perform(K.readNextFocusableItem, { capture: false });
        await delay(100);
        await sr.perform(K.toggleBetweenBrowseAndFocusMode, { capture: false });
        await delay(100);
        await sr.perform(K.toggleBetweenBrowseAndFocusMode, { capture: false });
        await delay(100);
        await sr.perform(K.exitFocusMode, { capture: false });
        await delay(100);
      },
      async toTop() {
        await sr.perform(K.exitFocusMode, { capture: false });
        await sr.perform(top, { capture: false });
        await delay(200);
      },
    };
  }
  const sr = gp.voiceOver;
  const K = gp.voiceOverKeyCodeCommands;
  const C = gp.VoiceOverCommanderCommands;
  const ctrl = () => sr.perform({ keyCode: gp.MacOSKeyCodes.Control }, { capture: false });
  return {
    sr,
    label: 'VoiceOver',
    version: macVersion() ? `macOS ${macVersion()}` : null,
    cmd: {
      headings: () => sr.perform(K.findNextHeading),
      landmarks: () => sr.perform(C.FIND_NEXT_LANDMARK),
      formFields: () => sr.perform(K.findNextControl),
      buttons: () => sr.perform(C.FIND_NEXT_BUTTON),
      links: () => sr.perform(K.findNextLink),
      graphics: () => sr.perform(K.findNextGraphic),
      // WebKit skips links on plain Tab (Safari's default); Option+Tab reaches every focusable item, like Safari users do.
      tab: (browserName) => sr.press(browserName === 'webkit' ? 'Option+Tab' : 'Tab'),
    },
    async focusWeb(page, browserName) {
      await gp.macOSActivateId(APP_ID[browserName] || APP_ID.webkit);
      await ctrl();
      await delay(100);
      await page.bringToFront();
      await page.evaluate(() => {
        const m = document.createElement('input');
        m.id = '__ada_sr_marker__';
        m.readOnly = true;
        m.tabIndex = -1;
        m.setAttribute('aria-label', 'Guidepup Marker');
        m.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
        document.body.prepend(m);
      });
      try {
        let said = '';
        for (let i = 0; i < 10 && !said.toLowerCase().includes('item chooser'); i++) {
          await ctrl();
          await sr.perform({ keyCode: gp.MacOSKeyCodes.Escape }, { capture: false });
          await sr.perform(K.openItemChooser, { capture: true });
          said = await sr.lastSpokenPhrase();
        }
        let matched = false;
        for (let a = 0; a < 10 && !matched; a++) {
          for (const ch of 'web content') {
            await ctrl();
            await sr.type(ch, { capture: 'initial' });
            if ((await sr.lastSpokenPhrase()).toLowerCase().includes('web content')) {
              matched = true;
              break;
            }
          }
          if (!matched) await sr.perform({ keyCode: gp.MacOSKeyCodes.Backspace }, { capture: false });
        }
        if (!matched) throw new Error('VoiceOver Item Chooser has no "web content" item');
        await sr.perform({ keyCode: gp.MacOSKeyCodes.Enter }, { capture: false });
        await sr.interact({ capture: false });
        await delay(100);
      } finally {
        await page.evaluate(() => document.getElementById('__ada_sr_marker__')?.remove()).catch(() => {});
      }
    },
    async toTop(page, browserName) {
      await this.focusWeb(page, browserName);
    },
  };
}

// NVDA ends a quick-nav pass with "no next …". VoiceOver says "Last link …" or "Landmark not found", but not always
// at the real end, so VoiceOver passes stop after several steps in a row that hear nothing new (a stall).
const END_RE = /^(no next|no previous|no more)/i;
const STALL_RE = /^(last (heading|link|image|form element|control|button|landmark|table|item|graphic)\b|\w+ not found$)/i;

export function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

async function runPass(a, page, pass, max, browserName, log, { stallLimit, passTimeout }) {
  const steps = [];
  let endReason = 'max';
  const deadline = Date.now() + passTimeout;
  await withTimeout(a.toTop(page, browserName), 90000, 'moving to the top of the page');
  if (pass === 'tab') {
    // Start Tab from the top of the document, like a user who just loaded the page.
    await page.evaluate(() => {
      document.activeElement?.blur?.();
      window.scrollTo(0, 0);
    });
  }
  const startUrl = page.url();
  const heard = new Set();
  let stall = 0;
  let firstSel = null;
  for (let i = 0; i < max; i++) {
    if (Date.now() > deadline) {
      endReason = 'time';
      break;
    }
    const before = (await a.sr.spokenPhraseLog()).length;
    const t0 = Date.now();
    await withTimeout(a.cmd[pass](browserName), 30000, `${pass} step ${i + 1}`);
    await delay(150);
    const log2 = await a.sr.spokenPhraseLog();
    const phrases = log2
      .slice(before)
      .map((s) => String(s).trim())
      .filter(Boolean);
    const last = await a.sr.lastSpokenPhrase().catch(() => phrases.at(-1) || '');
    const step = { phrases, last, ms: Date.now() - t0 };
    if (pass === 'tab') {
      step.dom = await page.evaluate(FOCUS_INFO).catch((e) => ({ error: e.message.split('\n')[0] }));
      if (page.url() !== startUrl) {
        step.dom.navigated = true;
        step.dom.url = page.url();
      }
    }
    steps.push(step);
    const spoken = (phrases.join(' ') || last).trim();
    if (END_RE.test(spoken)) {
      endReason = 'end';
      break;
    }
    if (pass === 'tab') {
      if (step.dom?.navigated) {
        endReason = 'navigated';
        break;
      }
      // Back on the first focused element: the Tab order wrapped around.
      if (step.dom?.selector && !firstSel) firstSel = step.dom.selector;
      else if (step.dom?.selector && step.dom.selector === firstSel && i > 1) {
        endReason = 'wrapped';
        break;
      }
      continue;
    }
    // Quick-nav stall: silence, a "Last …"/"… not found" message, or a phrase already heard in this pass.
    const key = spoken.toLowerCase();
    const isNew = key && !STALL_RE.test(spoken) && !heard.has(key);
    if (key) heard.add(key);
    stall = isNew ? 0 : stall + 1;
    if (stall >= stallLimit) {
      endReason = 'stall';
      break;
    }
  }
  log(`  ${PASS_LABEL[pass]}: ${steps.length} step(s), ended by ${endReason}`);
  return { pass, label: PASS_LABEL[pass], command: pass, endReason, steps };
}

export function transcriptText(t) {
  const L = [
    `Real screen-reader transcript: ${t.screenReader.name}${t.screenReader.version ? ' ' + t.screenReader.version : ''} with ${t.browser.name} ${t.browser.version || ''} on ${t.os.platform} ${t.os.release}`.trim(),
    `Evidence label: real screen reader (scripted navigation through Guidepup ${t.guidepup || ''}, not a human listener)`,
    `URL: ${t.url}`,
    `Journey: ${t.journey}   Started: ${t.startedAt}   Finished: ${t.finishedAt}`,
    `Read-only: nothing activated, typed or submitted; ${t.blockedWrites?.length || 0} non-GET request(s) blocked`,
    '',
  ];
  if (t.error) L.push(`RUN FAILED: ${t.error}`, '');
  for (const p of t.passes || []) {
    L.push(`== ${p.label} (${p.steps?.length || 0} steps, ended by ${p.endReason || '-'}) ==`);
    if (p.error) L.push(`  PASS FAILED: ${p.error}`);
    (p.steps || []).forEach((s, i) => {
      const said = s.phrases?.length ? s.phrases.join(' | ') : s.last || '(silence)';
      const dom = s.dom
        ? `   [focus: ${s.dom.none ? 'page body' : s.dom.selector || s.dom.tag}${s.dom.navigated ? ' NAVIGATED ' + s.dom.url : ''}]`
        : '';
      L.push(`${String(i + 1).padStart(3)}  ${said}${dom}`);
    });
    L.push('');
  }
  return L.join('\n');
}

/**
 * Run the journey with a real screen reader. Writes <out>/real-sr/<sr>-<browser>-<page>.json + .txt per page.
 * @returns {Promise<{files:string[], transcripts:object[]}>}
 */
export async function runRealScreenReader({
  journey,
  sr: want = 'auto',
  browser: browserName,
  out,
  log = console.error,
  headless = false,
  passTimeout = 240000,
  pageTimeout = 900000,
}) {
  const srName = resolveScreenReader(want);
  browserName = browserName || (srName === 'voiceover' ? 'webkit' : 'chromium');
  const gpMod = await import('@guidepup/guidepup');
  const gp = gpMod.default && gpMod.default.nvda ? gpMod.default : gpMod;
  const pw = await import('playwright');
  const type = ['chrome', 'msedge'].includes(browserName) ? 'chromium' : browserName;
  if (!pw[type]) throw new SrEnvironmentError(`unknown --browser "${browserName}" (use chromium, chrome, msedge, firefox or webkit)`);
  const a = adapterFor(srName, gp);
  const dir = path.join(out, 'real-sr');
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  const transcripts = [];
  const browser = await pw[type].launch({ headless, ...(type !== browserName ? { channel: browserName } : {}) });
  try {
    await a.sr.start({ capture: 'initial' });
    for (const url of journey.urls) {
      const { context, blocked } = await readOnlyContext(browser);
      const page = await context.newPage();
      const t = {
        schema: TRANSCRIPT_SCHEMA,
        tool: 'real-sr',
        screenReader: { id: srName, name: a.label, version: a.version },
        browser: { name: browserName, version: browser.version() },
        os: { platform: process.platform, release: os.release(), arch: process.arch },
        guidepup: guidepupVersion(),
        journey: journey.name,
        url,
        title: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        readOnly: true,
        readOnlyErrorsTested: false,
        passes: [],
        blockedWrites: blocked,
        error: null,
      };
      log(`${a.label} + ${browserName}: ${url}`);
      try {
        const pageDeadline = Date.now() + pageTimeout;
        await page.goto(url, { waitUntil: 'load', timeout: 90000 });
        await delay(1500);
        t.title = await page.title();
        // DOM fact, used only to tell whether links that sound the same go to different places (2.4.4).
        t.links = await page
          .evaluate(() =>
            [...document.querySelectorAll('a[href]')].slice(0, 500).map((a) => ({
              name: (
                a.getAttribute('aria-label') ||
                a.innerText ||
                [...a.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ') ||
                a.title ||
                ''
              )
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120),
              href: a.href,
            })),
          )
          .catch(() => []);
        // DOM fact, used only to rule out screen-reader quirks: an "Unlabeled graphic" whose spoken guess is its real alt.
        t.images = await page
          .evaluate(() =>
            [...document.images]
              .slice(0, 500)
              .map((i) => ({ alt: i.getAttribute('alt'), src: (i.currentSrc || i.src || '').slice(0, 200) })),
          )
          .catch(() => []);
        await withTimeout(a.focusWeb(page, browserName), 120000, 'focusing the web page');
        for (const { pass, max } of journey.steps) {
          try {
            if (Date.now() > pageDeadline) throw new Error(`page time budget (${Math.round(pageTimeout / 1000)} s) used up`);
            // NVDA says "no next …" at the end, so identical neighbours ("news, link" ×3) are real items; VoiceOver stalls.
            t.passes.push(
              await withTimeout(
                runPass(a, page, pass, max, browserName, log, { stallLimit: srName === 'nvda' ? 12 : 4, passTimeout }),
                passTimeout + 120000,
                `${pass} pass`,
              ),
            );
          } catch (e) {
            t.passes.push({ pass, label: PASS_LABEL[pass], command: pass, endReason: 'error', steps: [], error: e.message.split('\n')[0] });
            log(`  ${PASS_LABEL[pass]}: FAILED ${e.message.split('\n')[0]}`);
          }
          if (page.url() !== url)
            await page
              .goto(url, { waitUntil: 'load', timeout: 90000 })
              .then(() => withTimeout(a.focusWeb(page, browserName), 120000, 'refocusing'));
        }
      } catch (e) {
        t.error = e.message.split('\n')[0];
        log(`  run FAILED: ${t.error}`);
      } finally {
        t.finishedAt = new Date().toISOString();
        await context.close().catch(() => {});
      }
      const base = path.join(dir, `${srName}-${browserName}-${slug(url).slice(-60)}`);
      fs.writeFileSync(`${base}.json`, JSON.stringify(t, null, 2) + '\n');
      fs.writeFileSync(`${base}.txt`, transcriptText(t) + '\n');
      files.push(`${base}.json`, `${base}.txt`);
      transcripts.push(t);
    }
  } finally {
    await a.sr.stop().catch(() => {});
    await browser.close().catch(() => {});
  }
  return { files, transcripts };
}
