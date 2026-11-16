// lib.mjs: shared helpers for ada-audit-scripts. Read-only by design: every tool opens pages through safePage.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const VIEWPORTS = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

export function parseArgs(argv = process.argv.slice(2)) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) a[k] = true;
      else {
        a[k] = n;
        i++;
      }
    } else a._.push(t);
  }
  a.out = a.out || './audit-output';
  return a;
}

export function readUrls(args) {
  let list = [];
  if (args.urls) {
    if (fs.existsSync(args.urls)) list = fs.readFileSync(args.urls, 'utf8').split(/\r?\n/);
    else list = String(args.urls).split(',');
  }
  list.push(...args._);
  // '#' comments: whole-line or after whitespace (keeps URL fragments)
  return list.map((s) => s.replace(/(^|\s)#.*$/, '').trim()).filter(Boolean);
}

export function outDir(args, ...sub) {
  const d = path.join(args.out, ...sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function slug(u) {
  return u
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .slice(0, 80);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ALLOWED = new Set(['GET', 'HEAD', 'OPTIONS']);
// safePage: read-only browser. Never remove.
export async function safePage(args = {}, vp = VIEWPORTS.desktop, ctxOpts = {}) {
  // One browser per run: when the ada-audit runner shares a browser server (ADA_BROWSER_WS), connect to it
  // instead of launching; browser.close() then only closes this tool's contexts and disconnects.
  const ws = process.env.ADA_BROWSER_WS;
  const browser = ws
    ? await chromium.connect(ws, { timeout: 30000 })
    : await chromium.launch(args.channel ? { channel: args.channel } : {});
  const context = await browser.newContext({ viewport: vp, serviceWorkers: 'block', ...ctxOpts });
  const blockedWrites = [];
  await context.route('**/*', (route) => {
    const req = route.request();
    const m = req.method().toUpperCase();
    if (!ALLOWED.has(m)) {
      blockedWrites.push(`${m} ${req.url()}`);
      if (req.isNavigationRequest()) blockedWrites.nav = (blockedWrites.nav || 0) + 1;
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });
  const page = await context.newPage();
  page.blockedWrites = blockedWrites;
  context.on('page', (p) => {
    p.blockedWrites = blockedWrites;
  });
  return { browser, context, page, blockedWrites };
}

const NAV_TIMEOUT = Number(process.env.ADA_NAV_TIMEOUT || 90000);
const NAV_RETRIES = Number(process.env.ADA_NAV_RETRIES ?? 2);
const SETTLE = Number(process.env.ADA_SETTLE || 1500);
// open: networkidle first, then load; retries transient network errors (DNS, reset, 5xx-induced aborts) with backoff.
export async function open(page, url, { settle = SETTLE } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= NAV_RETRIES; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (/Timeout/i.test(e.message)) {
        await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT }).catch(() => {});
        lastErr = null;
        break;
      }
      if (attempt < NAV_RETRIES) {
        console.warn(`retry ${attempt + 1}/${NAV_RETRIES} ${url}: ${e.message.split('\n')[0]}`);
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  if (lastErr) console.warn(`WARNING: could not load ${url}: ${lastErr.message.split('\n')[0]}`);
  await sleep(settle);
  // bot-challenge / CDN block pages are not the site: warn so the output is discarded, never reported
  const blocked = await page
    .evaluate(() =>
      /request could not be satisfied|just a moment|attention required|access denied|verify you are (a )?human|are you a robot|checking your browser/i.test(
        document.title + ' ' + (document.body?.innerText || '').slice(0, 400),
      ),
    )
    .catch(() => false);
  if (blocked) {
    page.botChallenge = true;
    console.warn(`WARNING: ${url} looks like a bot-challenge or block page; discard this output (do not report it)`);
  }
}

export async function scrollThrough(page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += Math.max(200, innerHeight * 0.8)) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    scrollTo(0, 0);
  });
}

// --click prep: skip missing selectors; refuse submit controls.
export async function clickPrep(page, clickArg) {
  if (!clickArg) return [];
  const log = [];
  for (const sel of String(clickArg)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const el = await page.$(sel);
    if (!el) {
      log.push(`SKIP missing ${sel}`);
      continue;
    }
    const isSubmit = await el.evaluate((e) => {
      const t = (e.getAttribute('type') || '').toLowerCase();
      if (e.tagName === 'INPUT' && (t === 'submit' || t === 'image')) return true;
      if (e.tagName === 'BUTTON' && (t === 'submit' || (!t && e.form))) return true;
      return false;
    });
    if (isSubmit) {
      log.push(`REFUSED submit control ${sel}`);
      continue;
    }
    await el.click().catch((err) => log.push(`ERR ${sel} ${err.message}`));
    await sleep(1000);
    log.push(`CLICKED ${sel}`);
  }
  return log;
}

// WCAG contrast (ignores alpha)
export function parseRGB(s) {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1]
    .split(/[ ,/]+/)
    .filter(Boolean)
    .map(Number);
  return p.slice(0, 3);
}
function lum([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a, b) {
  const A = typeof a === 'string' ? parseRGB(a) : a,
    B = typeof b === 'string' ? parseRGB(b) : b;
  if (!A || !B) return null;
  const [l1, l2] = [lum(A), lum(B)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

// DESCRIBE_FOCUS: run in page via page.evaluate(DESCRIBE_FOCUS)
export const DESCRIBE_FOCUS = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { none: true };
  const cs = getComputedStyle(el);
  const role = el.getAttribute('role') || el.tagName.toLowerCase();
  const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('alt') || el.getAttribute('title') || (el.querySelector('img') && el.querySelector('img').alt) || '').trim().replace(/\\s+/g,' ').slice(0,120);
  let ring = 'NONE';
  if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ring = 'outline ' + cs.outlineWidth + ' ' + cs.outlineColor;
  else if (cs.boxShadow && cs.boxShadow !== 'none') ring = 'box-shadow ' + cs.boxShadow;
  const bgOf = e => { while (e) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)) return b; e = e.parentElement; } return 'rgb(255, 255, 255)'; };
  const r = el.getBoundingClientRect();
  const inView = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && r.width > 0;
  const pts = [[r.left + r.width/2, r.top + r.height/2], [r.left+2, r.top+2], [r.right-2, r.top+2], [r.left+2, r.bottom-2], [r.right-2, r.bottom-2]];
  const href = el.getAttribute('href');
  let covered = 0; const coverers = [];
  for (const [x,y] of pts) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const top = document.elementFromPoint(x,y);
    if (!top || top === el || el.contains(top) || top.contains(el)) continue;
    const tcs = getComputedStyle(top);
    const transparentEmpty = /rgba\\(0, 0, 0, 0\\)|transparent/.test(tcs.backgroundColor) && !top.innerText?.trim() && !top.querySelector('img,svg,video');
    if (transparentEmpty) continue;
    const twin = href && top.closest('a') && top.closest('a').getAttribute('href') === href;
    if (twin) continue;
    covered++; coverers.push(top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (top.className && typeof top.className === 'string' ? '.' + top.className.trim().split(/\\s+/)[0] : ''));
  }
  return { tag: el.tagName.toLowerCase(), role, name, id: el.id, href, ring, fg: cs.color, bg: bgOf(el), inView, covered, coverers: [...new Set(coverers)], rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
})()`;

export function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
import { createRequire as __cr } from 'node:module';
const PW_VERSION = (() => {
  try {
    return __cr(import.meta.url)('playwright/package.json').version;
  } catch {
    return '?';
  }
})();
export const TOOL_VERSION = (() => {
  try {
    return __cr(import.meta.url)('../../package.json').version;
  } catch {
    return '?';
  }
})();
export function header(tool, extra = '') {
  return `# ${tool} — ada-audit-scripts ${TOOL_VERSION} — ${new Date().toISOString()} — playwright ${PW_VERSION} ${extra}\n# Outputs are candidates: confirm in DOM + screenshot.\n`;
}
export const BODY_STATE = `(() => { const t=[...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,iframe,[tabindex]:not([tabindex="-1"])')].filter(e=>!e.disabled&&(e.offsetWidth||e.offsetHeight||e.getClientRects().length)); const lf=window.__lf; return { endOfOrder: !!lf && t.indexOf(lf)===t.length-1, lastTag: lf? lf.tagName.toLowerCase():null, lastBlurredByScript: !!(lf && /blur\\(/.test(lf.getAttribute('onfocus')||'')) }; })()`;
export async function trackFocus(page) {
  await page.evaluate(() => {
    if (!window.__lfInit) {
      window.__lfInit = 1;
      document.addEventListener(
        'focus',
        (e) => {
          window.__lf = e.target;
        },
        true,
      );
    }
  });
}

// guardNavigation: after arm(), abort main-frame navigations (GET included) and log them, so a tool can
// observe "would this change context?" without leaving the page. Falls back to safePage's write block.
export async function guardNavigation(page) {
  const navs = [];
  let armed = false;
  await page.route('**/*', (route) => {
    const r = route.request();
    if (armed && r.isNavigationRequest() && r.frame() === page.mainFrame()) {
      navs.push(`${r.method()} ${r.url()}`);
      return route.abort('aborted');
    }
    return route.fallback();
  });
  const popups = [];
  page.context().on('page', (p) => {
    if (armed) {
      popups.push(p.url() || '(popup)');
      p.close().catch(() => {});
    }
  });
  return {
    navs,
    popups,
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
    },
  };
}
export const PERSONAL = [
  // order matters: first match wins
  [/card ?number|\bcc\b|cc-?num/i, 'cc-number'],
  [/expir|\bexp\b|mm\s*\/\s*yy/i, 'cc-exp'],
  [/cvc|cvv|security code/i, 'cc-csc'],
  [/zip|postal|postcode/i, 'postal-code'],
  [/(one.?time|otp|verification|sms|auth\w*) ?code/i, 'one-time-code'],
  [/e-?mail/i, 'email'],
  [/user ?name|login/i, 'username'],
  [/new.?pass|confirm.?pass|pass(word)?\s*\(8|password2|pw2/i, 'new-password'],
  [/pass(word)?|\bpw\b/i, 'current-password'],
  [/phone|\btel\b|mobile/i, 'tel'],
  [/city|town/i, 'address-level2'],
  [/state|province|region/i, 'address-level1'],
  [/country/i, 'country-name'],
  [/street|address/i, 'street-address'],
  [/first name|given/i, 'given-name'],
  [/last name|surname|family/i, 'family-name'],
  [/full name|\bname\b/i, 'name'],
  [/birth|dob/i, 'bday'],
  [/organi[sz]ation|company/i, 'organization'],
];
export function purposeOf(text) {
  for (const [re, tok] of PERSONAL) if (re.test(text)) return tok;
  return null;
}
