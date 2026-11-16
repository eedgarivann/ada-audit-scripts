// journeys: goal-seeking persona journeys (keyboard, screen reader, zoom/low vision, tremor/motor, hurried/cognitive).
// SIMULATED users, not real people or real assistive technology. Strictly read-only: opens pages through safePage
// (non-GET requests aborted), follows only same-origin GET links that match the goal, never types into fields,
// never submits, never logs in, never pays. A persona STOPS when it reaches the final submit/pay/add-to-cart control.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs, readUrls, safePage, outDir, slug, sleep, header, writeJSON, BODY_STATE, trackFocus } from '../core/lib.mjs';
const require = createRequire(import.meta.url);
const args = parseArgs();
const urls = readUrls(args);
if (!urls.length) {
  console.error(
    'usage: node journeys.mjs --urls ... [--goal buy|checkout|contact|donate|book] [--target "lantern"] [--personas keyboard,sr,zoom,tremor,hurried] [--seed 7] [--budget 60] [--max-pages 4] [--speed 0.15] [--watch 20]',
  );
  process.exit(1);
}
const GOAL = String(args.goal || 'buy').toLowerCase(),
  SEED = Number(args.seed || 7),
  BUDGET = Number(args.budget || 60),
  MAXP = Number(args['max-pages'] || 4),
  SPEED = Number(args.speed ?? 0.15),
  WATCH = Number(args.watch || 20);
const SCOPE = args.scope && args.scope !== true ? String(args.scope) : null; // e.g. "#page" to ignore a demo wrapper
const PERSONAS = String(args.personas || 'keyboard,sr,zoom,tremor,hurried')
  .split(',')
  .map((s) => s.trim());
const TARGET =
  args.target && args.target !== true
    ? new RegExp(
        String(args.target)
          .split(/[,|]/)
          .map((s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'i',
      )
    : null;
const BANNER =
  'SIMULATED persona journeys (scripted heuristics + Guidepup Virtual Screen Reader). Not real users, not JAWS/NVDA/VoiceOver/TalkBack. Every finding is a candidate for a human to confirm.';
const dirRoot = outDir(args, 'journeys');

// ---------- goal model ----------
const GOALS = {
  buy: {
    terminal:
      /\b(add to (cart|bag|basket|trolley)|buy( it)? now|check ?out|place (my )?order|pay( now)?|complete (purchase|order)|purchase)\b/i,
    entry: /\b(shop( all| now)?|store|products?|collections?|catalog(ue)?|new arrivals|best ?sellers|sale|view product|details)\b/i,
    hrefEntry: /\/(products?|shop|collections?|store|item|p)\/|[?&](product|sku|pid)=/i,
  },
  checkout: {
    terminal: /\b(check ?out|proceed to checkout|place (my )?order|pay( now)?|complete (purchase|order))\b/i,
    entry: /\b(cart|bag|basket|trolley|view cart|my cart)\b/i,
    hrefEntry: /\/(cart|basket|bag|checkout)\b/i,
  },
  contact: {
    terminal:
      /\b(send( message)?|submit( message| enquiry| inquiry)?|request a (call|quote))\b|^mailto:|^tel:|[\w.+-]+@[\w-]+\.[a-z]{2,}|\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/i,
    entry: /\b(contact( us)?|get in touch|support|help ?(centre|center)?|reach us|talk to us|email us|call us|customer service)\b/i,
    hrefEntry: /\/(contact|support|help|get-in-touch)/i,
  },
  donate: {
    terminal: /\b(donate( now| today)?|give( now| today)?|complete (donation|gift)|make (a|my) (gift|donation))\b/i,
    entry: /\b(donate|give|ways to give|support us|contribute|get involved|membership)\b/i,
    hrefEntry: /\/(donate|give|support|giving)/i,
  },
  book: {
    terminal:
      /\b(book( now| a table| appointment)?|reserve( now)?|confirm (booking|reservation)|schedule( now)?|request (an )?appointment)\b/i,
    entry: /\b(book(ing)?|reserv(e|ations?)|appointments?|schedule|availability|plan (your )?visit|tickets?)\b/i,
    hrefEntry: /\/(book|reserv|appointment|schedule|tickets?)/i,
  },
};
const G = GOALS[GOAL] || { terminal: new RegExp(GOAL, 'i'), entry: new RegExp(GOAL, 'i'), hrefEntry: /$^/ };
const VAGUE =
  /^(click here|here|read more|more|learn more|details|continue|go|this|link|more info|info|see more|view|button|submit|image|graphic|\W*)$/i;
const DENY =
  /log ?out|sign ?out|unsubscribe|delete|remove|\/cart\/(add|change|clear|update)|add-to-cart=|\/account\/(login|register)|wp-login|logout|\/login|signin|sign-in/i;
function scoreItem({ name = '', role = '', href = '', hint = '', inGoalMenu = false, inScope = true }, { perceiveHint = true } = {}) {
  if (!inScope) return { score: 0, terminal: false, entry: false, unknown: false };
  const n = name.trim();
  const sees = perceiveHint ? `${n} ${hint}` : n;
  const r = { score: 0, terminal: false, entry: false, unknown: !n || VAGUE.test(n) };
  if (/^(button|submit|link|menuitem|a)$/.test(role) || href) {
    if (G.terminal.test(n) || (GOAL === 'contact' && /^(mailto|tel):/i.test(href))) {
      r.score = 100;
      r.terminal = true;
    } else if (G.entry.test(sees)) {
      r.score = 70;
      r.entry = true;
    }
  }
  if (TARGET && TARGET.test(sees) && (/^(button|submit|link|menuitem|a)$/.test(role) || href)) {
    r.score = Math.max(r.score, 60) + 15;
    r.entry = r.entry || !r.terminal;
  }
  if (!r.score && href && G.hrefEntry.test(href) && (perceiveHint || !n)) {
    r.score = 35;
    r.entry = true;
  }
  if (inGoalMenu && !r.terminal) {
    r.score += 25;
    r.entry = true;
  }
  if (DENY.test(href) || DENY.test(n)) {
    r.score = 0;
    r.entry = false;
    r.terminal = false;
  }
  return r;
}
const sameOrigin = (a, b) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};
let VISITED = []; // persona memory: never re-open a page it already tried
function safeFollow(href, base) {
  if (VISITED.some((v) => v.split('#')[0] === String(href).split('#')[0])) return false;
  return safeFollow0(href, base);
}
function safeFollow0(href, base) {
  if (!href || /^(javascript|mailto|tel):/i.test(href) || href.startsWith('#')) return false;
  let u;
  try {
    u = new URL(href, base);
  } catch {
    return false;
  }
  return sameOrigin(u.href, base) && !DENY.test(u.href) && u.href.split('#')[0] !== base.split('#')[0];
}
// seeded RNG (mulberry32) + Gaussian
function rngFor(s) {
  let a = s >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const gauss = (rng) => {
  let u = 0,
    v = 0;
  while (!u) u = rng();
  while (!v) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const readSecs = (text) =>
  0.6 +
  String(text || '')
    .split(/\s+/)
    .filter(Boolean).length /
    3.5; // ~210 wpm + orientation

// ---------- shared in-page probes ----------
const FOCUS_INFO = `(() => {
  const e = document.activeElement; if (!e || e === document.body || e === document.documentElement) return null;
  const txt = x => (x || '').trim().replace(/\\s+/g, ' ');
  const lab = e.getAttribute('aria-labelledby') ? e.getAttribute('aria-labelledby').split(/\\s+/).map(i => document.getElementById(i)?.innerText || '').join(' ') : '';
  const name = txt(e.getAttribute('aria-label') || lab || (e.labels && e.labels[0] && e.labels[0].innerText) || e.innerText || e.value || [...e.querySelectorAll('img[alt]')].map(i => i.alt).join(' ') || e.getAttribute('title') || '').slice(0, 100);
  const hint = txt([e.className && typeof e.className === 'string' ? e.className : '', e.id, e.querySelector('svg use')?.getAttribute('href') || '', e.querySelector('img')?.getAttribute('src')?.split('/').pop() || ''].join(' ')).slice(0, 160);
  const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const inView = r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  let coveredBy = null;
  if (inView) { const t = document.elementFromPoint(Math.min(Math.max(cx, 0), innerWidth - 1), Math.min(Math.max(cy, 0), innerHeight - 1)); if (t && t !== e && !e.contains(t) && !t.contains(e)) { const s = getComputedStyle(t); const clear = /rgba\\(0, 0, 0, 0\\)|transparent/.test(s.backgroundColor) && !t.innerText?.trim(); if (!clear) coveredBy = t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (typeof t.className === 'string' && t.className.trim() ? '.' + t.className.trim().split(/\\s+/)[0] : ''); } }
  const p = []; for (let x = e; x && x !== document.body && p.length < 6; x = x.parentElement) p.unshift(x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + ':' + [...(x.parentElement?.children || [])].indexOf(x));
  const type = (e.getAttribute('type') || '').toLowerCase(); const form = e.form || e.closest('form');
  const isSubmit = (e.tagName === 'BUTTON' && (type === 'submit' || (!type && !!form))) || (e.tagName === 'INPUT' && /submit|image/.test(type));
  const role = e.getAttribute('role') || ({ A: e.hasAttribute('href') ? 'link' : 'generic', BUTTON: 'button', SUMMARY: 'button', INPUT: isSubmit ? 'button' : 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox' }[e.tagName] || e.tagName.toLowerCase());
  const menuCtl = e.getAttribute('aria-controls') ? document.getElementById(e.getAttribute('aria-controls')) : null;
  const inGoalMenu = !!e.closest('[role=menu],.sub,.submenu,.dropdown,.mega-menu,[class*=dropdown],[class*=submenu],[class*=mega]') && !!e.closest('nav,header,[role=navigation]');
  const dlg = [...document.querySelectorAll('[aria-modal=true],dialog[open],[role=dialog],[role=alertdialog]')].find(d => d.getBoundingClientRect().width >= 50 && d.getBoundingClientRect().height >= 50 && getComputedStyle(d).visibility !== 'hidden' && Number(getComputedStyle(d).opacity) > 0);
  return { inScope: !window.__scopeSel || !!e.closest(window.__scopeSel), tag: e.tagName.toLowerCase(), role, name, hint, href: e.getAttribute('href') ? e.href : '', type, isSubmit, isText: /^(textbox|combobox|searchbox|spinbutton)$/.test(role) || (e.tagName === 'INPUT' && !/submit|button|image|checkbox|radio|reset/.test(type)), expanded: e.getAttribute('aria-expanded'), haspopup: e.getAttribute('aria-haspopup'), controls: e.getAttribute('aria-controls'), menuOpen: menuCtl ? menuCtl.getClientRects().length > 0 && getComputedStyle(menuCtl).display !== 'none' : null, inView, coveredBy, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, path: p.join('>'), inGoalMenu, inDialog: !!dlg && dlg.contains(e), dialogOpen: !!dlg, modalOpen: !!dlg && (dlg.getAttribute('aria-modal') === 'true' || dlg.matches('dialog:modal')), skipLike: e.tagName === 'A' && /^#/.test(e.getAttribute('href') || '') && /skip|jump|content|main/i.test(name), visibleRing: getComputedStyle(e).outlineStyle !== 'none' || getComputedStyle(e).boxShadow !== 'none' };
})()`;
// visible interactive things a SIGHTED person can perceive (whole page, rendered), with focusability
const SEEN = `(() => {
  const out = []; const txt = x => (x || '').trim().replace(/\\s+/g, ' ');
  for (const e of document.querySelectorAll('a[href],button,[role=button],[role=link],[role=menuitem],input[type=submit],input[type=button],input[type=image],summary,[onclick],[tabindex]')) {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    if (e.closest('[hidden]')) continue;
    { let clip = false; for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const xs = getComputedStyle(x); if (xs.visibility === 'hidden' || Number(xs.opacity) === 0) { clip = true; break; } if (xs.overflow !== 'visible' || xs.clipPath !== 'none') { const q = x.getBoundingClientRect(); if (q.width < 2 || q.height < 2 || r.bottom <= q.top || r.top >= q.bottom || r.right <= q.left || r.left >= q.right) { clip = true; break; } } } if (clip) continue; } // collapsed/clipped menus are not perceivable
    if (e.matches('[tabindex]') && !e.matches('a[href],button,input,summary,[onclick],[role=button],[role=link],[role=menuitem]') && (e.tabIndex < 0 || e.querySelector('a[href],button,input'))) continue;
    const name = txt(e.getAttribute('aria-label') || e.innerText || e.value || [...e.querySelectorAll('img[alt]')].map(i => i.alt).join(' ') || e.getAttribute('title') || '').slice(0, 100);
    const hint = txt([typeof e.className === 'string' ? e.className : '', e.id, e.querySelector('svg use')?.getAttribute('href') || '', e.querySelector('img')?.getAttribute('src')?.split('/').pop() || ''].join(' ')).slice(0, 160);
    const type = (e.getAttribute('type') || '').toLowerCase(); const isSubmit = (e.tagName === 'BUTTON' && (type === 'submit' || (!type && !!e.form))) || (e.tagName === 'INPUT' && /submit|image/.test(type));
    const role = e.getAttribute('role') || (e.tagName === 'A' ? 'link' : (e.tagName === 'BUTTON' || e.tagName === 'INPUT' || e.tagName === 'SUMMARY') ? 'button' : 'generic');
    const focusable = e.tabIndex >= 0 && !e.disabled && !e.closest('[inert]');
    if (!e.dataset.jid) e.dataset.jid = String(window.__jid = (window.__jid || 0) + 1);
    const par = e.parentElement; const inline = e.tagName === 'A' && cs.display === 'inline' && !!par && (par.innerText || '').trim().length > (e.innerText || '').trim().length + 10;
    if (window.__scopeSel && !e.closest(window.__scopeSel)) continue;
    out.push({ jid: e.dataset.jid, inert: !!e.closest('[inert]'), inline, name, hint, role: role === 'generic' && e.hasAttribute('onclick') ? 'button' : role, href: e.getAttribute('href') ? e.href : '', isSubmit, focusable, tag: e.tagName.toLowerCase(), inView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth, rect: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }, inGoalMenu: !!e.closest('.sub,.submenu,.dropdown,[class*=dropdown],[class*=submenu],[class*=mega],[role=menu]') });
  }
  return out;
})()`;
const OVERLAYS = `(() => [...document.querySelectorAll('body *')].filter(e => { const s = getComputedStyle(e); if (!/fixed|sticky/.test(s.position) || s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); const vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)); if (vis <= 0.2 * innerWidth * innerHeight || s.pointerEvents === 'none') return false; let on = 0, n = 0; const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, innerHeight); for (let i = 1; i < 5; i++) for (let k = 1; k < 5; k++) { n++; const t = document.elementFromPoint(x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * k / 5); if (t && (t === e || e.contains(t))) on++; } return on / n >= 0.5; /* only layers painted ON TOP of the page count; backgrounds/parallax under content do not */ }).filter((e, i, a) => !a.some(o => o !== e && o.contains(e))).map((e, i) => { e.dataset.ovid = String(i); const r = e.getBoundingClientRect(); return { ovid: String(i), el: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : ''), cover: Math.round(100 * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) / (innerWidth * innerHeight)), modal: e.getAttribute('aria-modal') === 'true' || e.getAttribute('role') === 'dialog' || !!e.querySelector('[aria-modal=true],[role=dialog]'), text: (e.innerText || '').trim().slice(0, 60) }; }))()`;

// ---------- run context ----------
class Journey {
  constructor(persona, url, d) {
    VISITED = this.pagesRef = [url];
    this.persona = persona;
    this.url = url;
    this.dir = d;
    this.rng = rngFor(SEED + hash(url + persona));
    this.steps = 0;
    this.keys = 0;
    this.sim = 0;
    this.frustration = 0;
    this.log = [];
    this.issues = [];
    this.shots = [];
    this.pages = this.pagesRef;
    this.outcome = null;
    this.baseline = null;
    this.t0 = Date.now();
    this.reasons = [];
  }
  note(s) {
    this.log.push(`${String(this.steps).padStart(3)} | ${this.sim.toFixed(1).padStart(6)}s | ${s}`);
  }
  issue(code, sc, conf, detail, extra = {}) {
    if (this.issues.some((i) => i.code === code && i.detail === detail)) return;
    this.issues.push({ code, sc, conf, detail, ...extra });
  }
  async shot(page, label) {
    const f = path.join(
      this.dir,
      `${this.persona}_${String(this.shots.length + 1).padStart(2, '0')}_${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`,
    );
    await page.screenshot({ path: f }).catch(() => {});
    this.shots.push(path.basename(f));
    return path.basename(f);
  }
  async pause(page, secs) {
    const j = secs * (0.75 + this.rng() * 0.5);
    this.sim += j;
    await sleep(Math.min(1500, 60 + SPEED * j * 1000));
  }
  frustrate(n, why) {
    this.frustration += n;
    this.note(`frustration +${n} (${this.frustration}/10): ${why}`);
  }
  done(outcome, why) {
    if (!this.outcome) {
      this.outcome = outcome;
      this.reasons.push(why);
      this.note(`${outcome.toUpperCase()}: ${why}`);
    }
  }
}
const dismissModal = async (page, j, who) => {
  // people close an on-load modal dialog before doing anything else; only aria-modal/dialog with Escape
  const open1 = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-modal=true],dialog[open]')].some(
      (d) => d.getBoundingClientRect().width >= 50 && d.getBoundingClientRect().height >= 50 && getComputedStyle(d).visibility !== 'hidden',
    ),
  );
  if (!open1) return;
  await page.keyboard.press('Escape');
  await sleep(300);
  const still = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-modal=true],dialog[open]')].some(
      (d) => d.getBoundingClientRect().width >= 50 && d.getBoundingClientRect().height >= 50 && getComputedStyle(d).visibility !== 'hidden',
    ),
  );
  j.note(`${who}: a modal dialog was open on load; Escape ${still ? 'did not close it (measuring behind it)' : 'closed it'}`);
};
// navigation guard: only intended GET navigations proceed; others are logged as unexpected context changes
async function armGuard(page, j) {
  page.__allowNav = false;
  page.__unexpected = [];
  if (SCOPE)
    await page.context().addInitScript((sel) => {
      window.__scopeSel = sel;
    }, SCOPE);
  await page.route('**/*', (route) => {
    const r = route.request();
    if (r.isNavigationRequest() && r.frame() === page.mainFrame() && !page.__allowNav) {
      page.__unexpected.push(r.url());
      j?.note(`blocked unexpected navigation to ${r.url()}`);
      j?.issue(
        'UNEXPECTED-NAVIGATION',
        '3.2.1/3.2.2/2.2.1',
        'medium',
        `the page tried to go to ${r.url()} without the persona asking (blocked)`,
      );
      return route.abort('aborted');
    }
    return route.fallback();
  });
}
async function go(page, url) {
  page.__allowNav = true;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  } finally {
    page.__allowNav = false;
  }
  await sleep(700);
}

const FOCUS_INDEX = `(() => { const a = document.activeElement; const list = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]')].filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]')); const pos = list.filter(e => e.tabIndex > 0).sort((x, y) => x.tabIndex - y.tabIndex); const ord = [...pos, ...list.filter(e => e.tabIndex === 0)]; const i = ord.indexOf(a); const m = document.querySelector('main,[role=main]'); const skip = ord.slice(0, 3).find(e => e.tagName === 'A' && /^#/.test(e.getAttribute('href') || '') && /skip|content|main/i.test(e.innerText)); let viaSkip = null; if (skip && m && i >= 0) { const after = ord.filter(e => m.contains(e)); const k = after.indexOf(a); if (k >= 0) viaSkip = ord.indexOf(skip) + 1 + 1 + k + 1; } return { idx: i + 1, viaSkip }; })()`;
// ---------- persona: keyboard-only (sighted) ----------
async function keyboardPersona(url, d) {
  const j = new Journey('keyboard', url, d);
  const { browser, page, blockedWrites } = await safePage(args, { width: 1280, height: 800 });
  await armGuard(page, j);
  await go(page, url);
  await trackFocus(page);
  let shiftInRound = false,
    closedAt = -99;
  const dialogTried = new Set(),
    altQueue = [];
  let roundStops = new Set(),
    escTried = false;
  let firstStop = null,
    wraps = 0,
    tried = new Set(),
    coverStreak = 0,
    lostStreak = 0,
    seen = new Map(),
    pending = null,
    lastPath = null,
    usedSkip = false;
  const activated = [];
  let triggerMode = false;
  const ovTried = new Set();
  // a blocking overlay (>=30% of the screen, fixed): try Escape, then Tab to a close control; full-screen with no keyboard exit = stuck
  const handleOverlay = async () => {
    const ov = (await page.evaluate(OVERLAYS)).filter((o) => o.cover >= 30 && !ovTried.has(o.el));
    if (!ov.length) return false;
    const o = ov[0];
    ovTried.add(o.el);
    j.note(`sees ${o.el} covering ${o.cover}% ("${o.text.replace(/\s+/g, ' ').slice(0, 40)}"); tries Escape`);
    await page.keyboard.press('Escape');
    closedAt = j.steps;
    j.keys++;
    j.steps++;
    await j.pause(page, 0.8);
    const still = () =>
      page.evaluate((id) => {
        const e = document.querySelector(`[data-ovid="${id}"]`);
        return (
          !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'
        );
      }, o.ovid);
    if (!(await still())) {
      j.note('Escape closed it');
      return false;
    }
    const CLOSE = /^(close|×|✕|x|dismiss|no,? thanks|not now|reject( all)?|decline|accept( all)?|got it|ok|i agree|agree|continue|skip)$/i;
    for (let k = 0; k < 15; k++) {
      await page.keyboard.press('Tab');
      j.keys++;
      j.steps++;
      await j.pause(page, 0.35);
      const f = await page.evaluate(FOCUS_INFO);
      if (!f) continue;
      const inside = await page.evaluate((id) => {
        const e = document.querySelector(`[data-ovid="${id}"]`);
        return !!e && e.contains(document.activeElement);
      }, o.ovid);
      if (inside && !f.isSubmit && !f.href && CLOSE.test(f.name.replace(/[^\w×✕ ,]/g, '').trim())) {
        j.note(`Tabs to "${f.name}" inside it and presses Enter`);
        await page.keyboard.press('Enter');
        j.keys++;
        j.steps++;
        await j.pause(page, 0.8);
        if (!(await still())) {
          j.note('overlay closed');
          return false;
        }
      }
    }
    const vis = await page.evaluate((id) => {
      const e = document.querySelector(`[data-ovid="${id}"]`);
      return [...e.querySelectorAll('*')]
        .filter(
          (x) =>
            x.children.length === 0 &&
            /^(close|×|✕|x|accept|reject|dismiss|ok|got it|no thanks)$/i.test((x.innerText || x.getAttribute('aria-label') || '').trim()) &&
            x.getClientRects().length,
        )
        .map(
          (x) =>
            `${x.tagName.toLowerCase()} "${(x.innerText || x.getAttribute('aria-label')).trim()}"${x.tabIndex >= 0 ? '' : ' (not focusable)'}`,
        )
        .slice(0, 3);
    }, o.ovid);
    const sh = await j.shot(page, 'overlay-no-keyboard-exit');
    j.issue(
      'OVERLAY-NO-KEYBOARD-EXIT',
      '2.1.1/2.1.2',
      'high',
      `${o.el} covers ${o.cover}% and neither Escape nor any keyboard-reachable control closes it${vis.length ? ' (visible: ' + vis.join(', ') + ')' : ''}`,
      { shot: sh },
    );
    if (o.cover >= 85) {
      j.done('stuck', `blocked by ${o.el} (${o.cover}% of the screen) with no keyboard way to close it`);
      return true;
    }
    j.frustrate(2, `${o.el} stays on screen`);
    return false;
  };
  const roundTrap = async () => {
    // a whole Tab round visited only 1-2 stops on a page with many controls = trapped
    const n = await page.evaluate(
      () =>
        [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea')].filter(
          (e) => e.getClientRects().length && !e.closest('[inert]'),
        ).length,
    );
    const rs = roundStops.size;
    roundStops = new Set();
    if (shiftInRound) {
      shiftInRound = false;
      return false;
    } // a round walked partly backwards is not a trap measurement
    if (rs > 0 && rs <= 2 && n > 6) {
      const ov = await page.evaluate(OVERLAYS);
      const sh = await j.shot(page, 'trapped');
      j.issue(
        'KEYBOARD-TRAP',
        '2.1.2',
        'high',
        `a full Tab round reaches only ${rs} control(s) out of ${n}${ov.length ? ' — stuck in ' + ov.map((o) => `${o.el} (${o.cover}% of screen, "${o.text.replace(/\s+/g, ' ').slice(0, 40)}")`).join(', ') : ''}`,
        { shot: sh },
      );
      j.done('stuck', `keyboard trapped${ov.length ? ' in ' + ov[0].el : ''}: Tab only cycles ${rs} control(s)`);
      return true;
    }
    return false;
  };
  const pageTargets = async () =>
    (await page.evaluate(SEEN))
      .map((s) => ({ ...s, ...scoreItem(s) }))
      .filter((s) => s.score >= 50)
      .sort((a, b) => b.score - a.score);
  let vis = await pageTargets();
  j.note(
    `page 1: ${await page.title()} | sighted scan: ${
      vis.length
        ? vis
            .slice(0, 3)
            .map((v) => `"${v.name || v.hint.slice(0, 30)}"${v.focusable ? '' : ' (NOT focusable)'}`)
            .join(', ')
        : 'no goal-like control visible'
    }`,
  );
  await j.pause(page, readSecs(await page.evaluate(() => document.body.innerText.slice(0, 400))));
  await handleOverlay();
  while (!j.outcome) {
    if (j.steps >= BUDGET) {
      j.done('gave up', `step budget (${BUDGET}) used up`);
      await j.shot(page, 'budget');
      break;
    }
    if (j.frustration >= 10) {
      j.done('gave up', 'too frustrated: ' + j.reasons.join('; '));
      await j.shot(page, 'frustrated');
      break;
    }
    const key = pending || altQueue.shift() || 'Tab';
    pending = null;
    if (key === 'Tab' && j.steps > 2 && j.rng() < 0.05) {
      await page.keyboard.press('Shift+Tab');
      j.keys++;
      j.note('slip: pressed Shift+Tab by mistake, correcting');
      await j.pause(page, 0.6);
      await page.keyboard.press('Tab');
      j.keys++;
    }
    const before = await page.evaluate(FOCUS_INFO);
    const navKey = key === 'Enter' && before && before.href && safeFollow(before.href, page.url());
    if (navKey) page.__allowNav = true;
    await page.keyboard.press(key);
    if (key === 'Escape' || (key === 'Enter' && before?.inDialog)) closedAt = j.steps;
    j.steps++;
    j.keys++;
    if (key === 'Shift+Tab') shiftInRound = true;
    if (navKey) {
      await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
      await sleep(600);
      page.__allowNav = false;
    }
    await j.pause(page, key === 'Tab' ? 0.35 : 0.8);
    let f = await page.evaluate(FOCUS_INFO);
    // page changed?
    if (page.url().split('#')[0] !== j.pages[j.pages.length - 1].split('#')[0]) {
      j.pages.push(page.url());
      await trackFocus(page);
      firstStop = null;
      wraps = 0;
      tried = new Set();
      seen = new Map();
      triggerMode = false;
      usedSkip = false;
      vis = await pageTargets();
      j.note(
        `page ${j.pages.length}: ${await page.title()} | sighted scan: ${
          vis
            .slice(0, 3)
            .map((v) => `"${v.name || v.hint.slice(0, 30)}"${v.focusable ? '' : ' (NOT focusable)'}`)
            .join(', ') || 'nothing goal-like'
        }`,
      );
      await j.pause(page, readSecs(await page.evaluate(() => document.body.innerText.slice(0, 300))));
      continue;
    }
    // focus stolen while the persona was reading?
    await j.pause(page, f ? readSecs(f.name) * 0.4 : 0.2);
    const f2 = await page.evaluate(FOCUS_INFO);
    if (f && f2 && f2.path !== f.path && !(f2.name && f2.name === f.name)) {
      j.issue('FOCUS-STOLEN', '2.4.3/3.2.1/2.2.2', 'high', `focus moved from "${f.name}" to "${f2.name || f2.tag}" without any key press`);
      j.frustrate(2, `focus jumped to "${f2.name || f2.tag}" by itself`);
      f = f2;
    }
    if (!f) {
      const bs = await page.evaluate(BODY_STATE);
      if (bs.endOfOrder) {
        j.note('end of Tab order (wraps to browser UI)');
        wraps++;
        if (wraps >= 2 && (await roundTrap())) break;
      } else if (j.steps - closedAt <= 3) {
        j.note('focus went to the page start after the dialog closed (no trigger to return to)');
      } else {
        lostStreak++;
        j.issue('FOCUS-LOST', '2.4.3/2.4.7', 'medium', `focus fell to <body> after ${bs.lastTag || '?'}`);
        j.frustrate(1, 'focus vanished');
        if (lostStreak >= 4) {
          j.done('gave up', 'focus keeps disappearing');
          await j.shot(page, 'focus-lost');
        }
      }
      if (wraps >= 2) j.done('gave up', 'went round the whole page twice without finding the goal');
      continue;
    }
    lostStreak = 0;
    const s = scoreItem(f);
    const st = `${page.url()}|${f.path}|${f.expanded}|${f.dialogOpen}`;
    const visits = (seen.get(st) || 0) + 1;
    seen.set(st, visits);
    j.note(
      `${key} → ${f.role} "${f.name || '(no name)'}"${f.coveredBy ? ` COVERED by ${f.coveredBy}` : ''}${f.inView ? '' : ' OFF-SCREEN'}${s.score ? ` [goal score ${s.score}]` : ''}`,
    );
    if (f.coveredBy && (await handleOverlay())) break;
    if (f.coveredBy) {
      coverStreak++;
      if (coverStreak === 1) {
        const sh = await j.shot(page, 'focus-behind-overlay');
        j.issue('FOCUS-BEHIND-OVERLAY', '2.4.11/2.4.3', 'high', `focused "${f.name || f.tag}" is hidden under ${f.coveredBy}`, {
          shot: sh,
        });
      }
      j.frustrate(1, `can't see where focus is (under ${f.coveredBy})`);
      if (coverStreak === 2) altQueue.push('Escape');
      if (coverStreak >= 7) {
        j.done('gave up', `focus keeps going behind ${f.coveredBy}`);
        break;
      }
    } else coverStreak = 0;
    if (!f.inView && !f.coveredBy) {
      j.issue('FOCUS-OFFSCREEN', '2.4.7/2.4.11', 'medium', `"${f.name || f.tag}" focused off-screen`);
      j.frustrate(0.5, 'focus off-screen');
    }
    if (visits >= 3) {
      j.frustrate(2, `same spot again ("${f.name || f.tag}")`);
      if (!altQueue.length && visits === 3) {
        altQueue.push('Escape', 'Shift+Tab', 'Shift+Tab');
        j.note('trying Escape, then Shift+Tab to get out');
      }
      if (visits >= 6) {
        const ov = await page.evaluate(OVERLAYS);
        const sh = await j.shot(page, 'trapped');
        j.issue(
          'KEYBOARD-TRAP',
          '2.1.2',
          'high',
          `focus cycles on "${f.name || f.tag}"${ov.length ? ' inside ' + ov.map((o) => `${o.el} (${o.cover}% of screen)`).join(', ') : ''}; Escape and Shift+Tab did not release it`,
          { shot: sh },
        );
        j.done('stuck', `trapped at "${f.name || f.tag}"${ov.length ? ' in ' + ov[0].el : ''}`);
        break;
      }
    }
    roundStops.add(f.path);
    // a dialog/banner is open and the goal is not in it: try Escape, then a close/dismiss button (never submit)
    if (f.dialogOpen && !s.terminal && !dialogTried.has(page.url() + f.dialogOpen)) {
      if (!f.inDialog && f.modalOpen) {
        j.issue('FOCUS-OUTSIDE-OPEN-DIALOG', '2.4.3/2.4.11', 'high', `a dialog is open but focus is on "${f.name || f.tag}" behind it`);
      }
      const closeName =
        /^(close( (dialog|popup|modal|banner|window|form|this))?|×|x|dismiss|no,? thanks|not now|reject( all)?|decline|accept( all)?|got it|ok|continue)$/i;
      if (f.inDialog && f.role === 'button' && !f.isSubmit && closeName.test(f.name.replace(/[^\w× ,]/g, '').trim())) {
        j.note(`closes the dialog with "${f.name}"`);
        dialogTried.add(page.url() + f.dialogOpen);
        pending = 'Enter';
        continue;
      }
      if (!escTried) {
        escTried = true;
        altQueue.unshift('Escape');
        j.note('dialog open: tries Escape');
      }
    }
    if (f.coveredBy) {
      lastPath = f.path;
      continue;
    } // cannot see what is focused: cannot judge it
    if (firstStop === null) firstStop = f.path;
    else if (f.path === firstStop && lastPath !== f.path) {
      wraps++;
      j.note(`back at the first stop (round ${wraps})`);
      if (await roundTrap()) break;
      if (wraps === 1) triggerMode = true;
      if (wraps >= 2) {
        j.done('gave up', 'went round the whole page twice without finding the goal');
        break;
      }
    }
    lastPath = f.path;
    // skip link: use it when the goal seen on screen is in the content area
    if (f.skipLike && !usedSkip && j.steps <= 3) {
      usedSkip = true;
      const inMain = vis.some((v) => v.rect.y > 250);
      if (inMain) {
        j.note('skip link: using it (goal looks like it is in the page content)');
        pending = 'Enter';
        continue;
      }
    }
    if (s.terminal) {
      if (f.isSubmit || f.role === 'button' || f.href) {
        j.done('reached', `final control "${f.name}" is focused and operable by keyboard (not activated: read-only)`);
        await j.shot(page, 'reached');
        activated.push({ ...(await page.evaluate(FOCUS_INDEX)), enter: 0 });
        break;
      }
    }
    if (f.href && s.entry && s.score >= 50 && j.pages.length < MAXP && safeFollow(f.href, page.url())) {
      j.note(`following "${f.name || f.hint}" (looks like the way to ${GOAL})`);
      pending = 'Enter';
      activated.push({ ...(await page.evaluate(FOCUS_INDEX)), enter: 1 });
      continue;
    }
    const triggerish =
      f.inScope &&
      !f.href &&
      !/^skip\b/i.test(f.name) &&
      (f.expanded !== null || f.haspopup || f.role === 'button') &&
      (f.expanded === 'false' || f.haspopup || /menu|☰|categories|shop|navigation/i.test(f.name + ' ' + f.hint)) &&
      !f.isSubmit &&
      !f.isText;
    if (triggerish && !tried.has(f.path) && (s.score >= 25 || /shop|menu|☰/i.test(f.name) || triggerMode)) {
      tried.add(f.path);
      const nBefore = (await page.evaluate(SEEN)).length;
      await page.evaluate(() => {
        document.querySelectorAll('[data-jtrig]').forEach((x) => x.removeAttribute('data-jtrig'));
        document.activeElement?.setAttribute('data-jtrig', '1');
      });
      await page.keyboard.press('Enter');
      j.keys++;
      j.steps++;
      await j.pause(page, 0.8);
      let nAfter = (await page.evaluate(SEEN)).length;
      let how = 'Enter';
      for (let k = 0; k < 6 && nAfter <= nBefore; k++) {
        const [expNow, movedIn] = await page.evaluate(() => {
          const t = document.querySelector('[data-jtrig]');
          const a = document.activeElement;
          const box = t?.closest('li') || t?.parentElement;
          return [t?.getAttribute('aria-expanded'), !!(t && a && a !== t && a !== document.body && box && box.contains(a))];
        });
        if ((f.expanded !== 'true' && expNow === 'true') || movedIn) {
          nAfter = nBefore + 1;
          break;
        }
        await sleep(200);
        nAfter = (await page.evaluate(SEEN)).length;
      } // menus that animate open: poll ~1.2 s for aria-expanded or new controls
      if (nAfter <= nBefore) {
        await page.keyboard.press('Space');
        j.keys++;
        j.steps++;
        await j.pause(page, 0.8);
        nAfter = (await page.evaluate(SEEN)).length;
        how = 'Space';
      }
      if (nAfter > nBefore) {
        j.note(`opened "${f.name}" with ${how} (${nAfter - nBefore} new controls)`);
        vis = await pageTargets();
        if (f.haspopup === 'menu' || f.haspopup === 'true') altQueue.push('ArrowDown');
        activated.push({ ...(await page.evaluate(FOCUS_INDEX)), enter: 1, trigger: true });
      } else {
        j.issue(
          'TRIGGER-DEAD-KEYBOARD',
          '2.1.1/4.1.2',
          'medium',
          `"${f.name || f.tag}" looks like a menu/disclosure but Enter and Space did nothing`,
        );
        j.frustrate(1, `"${f.name}" doesn't open by keyboard`);
      }
    }
  }
  // what a sighted keyboard user could see but never reach
  const unreach = (await page.evaluate(SEEN))
    .map((s) => ({ ...s, ...scoreItem(s) }))
    .filter((s) => s.score >= 50 && !s.focusable && !s.inert);
  for (const u of unreach.slice(0, 3))
    j.issue(
      'SEEN-NOT-FOCUSABLE',
      '2.1.1',
      'high',
      `"${u.name || u.hint.slice(0, 40)}" (${u.tag}) is visible and looks like the way to ${GOAL}, but cannot be reached with Tab`,
    );
  if (j.outcome !== 'reached') {
    // hover-only hint: goal-like links that exist in DOM but are hidden and have no keyboard way in
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll('nav a[href],header a[href]')]
        .filter(
          (a) => (!a.getClientRects().length || getComputedStyle(a).visibility === 'hidden') && !a.closest('[aria-modal],[role=dialog]'),
        )
        .filter((a) => {
          for (let x = a.parentElement; x && x !== document.body; x = x.parentElement) {
            const trig = [...x.querySelectorAll('button,[aria-expanded],summary,[aria-haspopup]')].find(
              (t) => t.getClientRects().length && t.tabIndex >= 0,
            );
            if (trig) return false;
            if (x.matches('li,nav,header')) break;
          }
          const det = a.closest('details');
          return !det;
        })
        .map((a) => (a.innerText || a.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 8),
    );
    if (hidden.length)
      j.issue(
        'HIDDEN-NAV-LINKS',
        '2.1.1/1.4.13',
        'medium',
        `nav links never shown to a keyboard user: ${hidden.join(', ')} (hover-only menu?)`,
      );
  }
  // efficient baseline: Tab index of each activated control in DOM focus order (+1 Enter each)
  // menu items opened by a trigger are counted from the trigger, so subtract the trigger's own index
  let bl = 0,
    prevTrig = null;
  for (const a of activated) {
    const best = Math.min(a.idx > 0 ? a.idx : 99, a.viaSkip || 99);
    bl += (prevTrig ? Math.max(1, best - prevTrig) : best) + a.enter;
    prevTrig = a.trigger ? best : null;
  }
  j.baseline = activated.length && j.outcome === 'reached' ? Math.min(bl, j.keys) : null;
  if (blockedWrites.length) j.note(`blocked writes: ${blockedWrites.join(' | ')}`);
  await browser.close();
  return j;
}

// ---------- persona: screen reader (virtual) ----------
const pkgDir = path.dirname(require.resolve('@guidepup/virtual-screen-reader/package.json'));
let VSR = fs.readFileSync(path.join(pkgDir, 'lib/esm/index.browser.js'), 'utf8');
VSR = VSR.replace(
  /export\s*\{([^}]*)\}\s*;?/,
  (m, inner) =>
    `window.__vsr={${inner
      .split(',')
      .map((p) => {
        const [a, b] = p.trim().split(/\s+as\s+/);
        return `${(b || a).trim()}:${a.trim()}`;
      })
      .join(',')}};`,
).replace(/\/\/# sourceMappingURL=.*$/m, '');
async function injectVSR(page) {
  await page
    .evaluate((code) => {
      const s = document.createElement('script');
      s.type = 'module';
      s.textContent = code;
      document.head.appendChild(s);
    }, VSR)
    .catch(() => {});
  await page.waitForFunction(() => !!window.__vsr, null, { timeout: 10000 }).catch(() => {});
  if (!(await page.evaluate(() => !!window.__vsr)))
    await page
      .evaluate(
        (code) => {
          (0, eval)(code);
        },
        VSR.replace(/^import .*$/gm, ''),
      )
      .catch(() => {});
  return page.evaluate(() => !!window.__vsr);
}
// run one SR command sequence in page: returns list of {phrase, href, tag, idx}
const SR_SCAN = async ({ cmd, max }) => {
  const v = window.__vsr.virtual;
  if (!window.__vsrOn) {
    document.querySelectorAll('noscript').forEach((n) => n.remove());
    await v.start({ container: document.body });
    window.__vsrOn = 1;
    window.__nodes = [];
  } else {
    await v.stop();
    await v.start({ container: document.body });
  }
  const items = [];
  let last = null;
  for (let i = 0; i < max; i++) {
    if (cmd === 'next') await v.next();
    else await v.perform(v.commands[cmd]);
    const phrase = await v.lastSpokenPhrase();
    const n = v.activeNode;
    if (!n || n === last) break;
    last = n;
    const el = n.nodeType === 1 ? n : n.parentElement;
    const a = el && el.closest('a[href],button,[role=button],input,[role=link]');
    if (window.__scopeSel && el && !el.closest(window.__scopeSel)) {
      window.__nodes.push(el);
      continue;
    }
    window.__nodes.push(a || el);
    items.push({
      phrase: String(phrase).slice(0, 160),
      href: a && a.getAttribute('href') ? a.href : '',
      tag: a ? a.tagName.toLowerCase() : el ? el.tagName.toLowerCase() : '',
      isSubmit:
        !!a &&
        ((a.tagName === 'BUTTON' && ((a.getAttribute('type') || '') === 'submit' || (!a.getAttribute('type') && !!a.form))) ||
          (a.tagName === 'INPUT' && /submit|image/.test(a.type))),
      expanded: a ? a.getAttribute('aria-expanded') : null,
      ref: window.__nodes.length - 1,
    });
    if (/end of document/i.test(phrase)) break;
  }
  return items;
};
function parsePhrase(p) {
  // "link, Lanterns" / "button, Add to cart" / "heading, X, level 2"
  const m = p.match(
    /^(link|button|heading|navigation|main|banner|contentinfo|search|form|region|complementary|menuitem|combobox|textbox|img|image|graphic)(?:,\s*(.*))?$/i,
  );
  if (!m) return { role: 'text', name: p };
  const name = (m[2] || '')
    .replace(/,\s*level \d$/i, '')
    .replace(/,\s*(collapsed|expanded|not expanded|has popup.*|current page|visited)$/i, '')
    .trim();
  return { role: m[1].toLowerCase(), name };
}
async function srPersona(url, d) {
  const j = new Journey('sr', url, d);
  const { browser, page, blockedWrites } = await safePage(args, { width: 1280, height: 800 });
  await armGuard(page, j);
  await go(page, url);
  let guesses = 0,
    cmds = 0;
  const bestIdx = [];
  pageLoop: for (let pg = 0; pg < MAXP && !j.outcome; pg++) {
    if (!(await injectVSR(page))) {
      j.done('error', 'could not start the virtual screen reader (CSP?)');
      break;
    }
    const title = await page.title();
    j.note(`page ${j.pages.length}: hears title "${title}"`);
    j.sim += readSecs(title);
    await sleep(1200);
    const dlg = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[aria-modal=true],dialog[open]')].find(
        (d) =>
          d.getBoundingClientRect().width >= 50 &&
          d.getBoundingClientRect().height >= 50 &&
          getComputedStyle(d).visibility !== 'hidden' &&
          Number(getComputedStyle(d).opacity) > 0,
      );
      return d ? (d.getAttribute('aria-label') || d.querySelector('h1,h2,h3')?.innerText || 'dialog').trim().slice(0, 40) : null;
    });
    if (dlg) {
      j.note(`hears a dialog "${dlg}"; presses Escape`);
      await page.keyboard.press('Escape');
      cmds++;
      j.steps++;
      await sleep(500);
      const still = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[aria-modal=true],dialog[open]')].find(
          (d) =>
            d.getBoundingClientRect().width >= 50 &&
            d.getBoundingClientRect().height >= 50 &&
            getComputedStyle(d).visibility !== 'hidden' &&
            Number(getComputedStyle(d).opacity) > 0,
        );
        if (!d) return false;
        const b = [...d.querySelectorAll('button,[role=button]')].find(
          (b) =>
            /close|dismiss|no thanks|not now|reject|decline|×/i.test((b.getAttribute('aria-label') || '') + ' ' + b.innerText) &&
            !(b.form && b.type === 'submit'),
        );
        if (b) {
          b.click();
          return 'closed with ' + (b.getAttribute('aria-label') || b.innerText).trim();
        }
        return true;
      });
      if (still === true) {
        j.issue('SR-DIALOG-NO-EXIT', '2.1.2/4.1.2', 'high', `dialog "${dlg}" does not close with Escape and has no labelled close button`);
      } else if (still) j.note(still);
      await injectVSR(page);
    }
    // what is visually going on that the SR user is NOT told about
    const ov = await page.evaluate(OVERLAYS);
    for (const o of ov.filter((o) => o.cover >= 30 && !o.modal))
      j.issue(
        'VISUAL-OVERLAY-NOT-EXPOSED',
        '4.1.2/1.3.1',
        'medium',
        `${o.el} covers ${o.cover}% of the screen ("${o.text}") but is not a dialog: a screen-reader user is not told it is there`,
      );
    const scan = async (cmd, max) => {
      const r = await page.evaluate(SR_SCAN, { cmd, max }).catch((e) => {
        j.note('VSR error ' + e.message.split('\n')[0]);
        return [];
      });
      return r.map((it) => ({ ...it, ...parsePhrase(it.phrase) }));
    };
    const scanSilent = async (cmd, max) =>
      (await page.evaluate(SR_SCAN, { cmd, max }).catch(() => [])).map((it) => ({ ...it, ...parsePhrase(it.phrase) }));
    const judge = (it) =>
      scoreItem(
        { name: it.name, role: it.role === 'menuitem' ? 'link' : it.role, href: it.role === 'link' && !it.name ? it.href : '' },
        { perceiveHint: false },
      );
    const charge = (items, n) => {
      for (const it of items.slice(0, n)) j.sim += 0.4 + readSecs(it.phrase) * 0.4;
      cmds += n;
      j.steps += n;
    };
    const tryItems = async (items, how) => {
      // satisficing, like a person: stop at the first item that plausibly leads to the goal
      const sc = items
        .map((it, i) => ({ it, i, ...judge(it) }))
        .filter((x) => x.score >= 50 && (x.terminal || (x.it.href ? safeFollow(x.it.href, page.url()) : x.it.role === 'button')));
      const t = sc[0];
      charge(items, t ? t.i + 1 : items.length);
      if (!t) return false;
      let alt = t.i + 1;
      if (t.it.role === 'link' && t.it.name) {
        const ll = await scanSilent('moveToNextLink', 200);
        const k = ll.findIndex((x) => x.name === t.it.name);
        if (k >= 0) alt = Math.min(alt, Math.min(k + 1, 3) + 1);
      } // links list + type-ahead ≈ 2-4 keys
      bestIdx.push(alt);
      if (t.terminal) {
        j.done('reached', `found "${t.it.phrase}" via ${how} after ${cmds} SR commands (not activated: read-only)`);
        await j.shot(page, 'reached');
        if (VAGUE.test(t.it.name) || t.it.name.length < 3)
          j.issue('VAGUE-TARGET-NAME', '2.4.4/2.4.6', 'medium', `final control announced as "${t.it.phrase}"`);
        const dup = items.filter((x) => x.name === t.it.name).length;
        if (dup > 2)
          j.issue(
            'DUPLICATE-TARGET-NAME',
            '2.4.4/2.4.6',
            'low',
            `${dup} controls announced "${t.it.phrase}" with no product/context in the name`,
          );
        return true;
      }
      if (t.it.href && safeFollow(t.it.href, page.url())) {
        j.note(`${how}: picks "${t.it.phrase}" and activates it`);
        await go(page, t.it.href);
        j.pages.push(page.url());
        return 'nav';
      }
      if (t.it.role === 'button' && t.it.expanded === 'false') {
        j.note(`${how}: "${t.it.phrase}" is collapsed, activates it`);
        await page.evaluate((ref) => window.__nodes[ref]?.click(), t.it.ref);
        await sleep(500);
        return 'expanded';
      }
      return false;
    };
    const readFrom = async (ref, mx) => {
      const down = await page
        .evaluate(
          async ({ ref, max }) => {
            const v = window.__vsr.virtual;
            const out = [];
            await v.stop();
            await v.start({ container: document.body });
            for (let k = 0; k < 400; k++) {
              await v.next();
              if (
                v.activeNode === window.__nodes[ref] ||
                (v.activeNode && window.__nodes[ref] && window.__nodes[ref].contains(v.activeNode))
              )
                break;
            }
            for (let k = 0; k < max; k++) {
              await v.next();
              const n = v.activeNode;
              const el = n && (n.nodeType === 1 ? n : n.parentElement);
              const a = el && el.closest('a[href],button,[role=button],input');
              window.__nodes.push(a || el);
              out.push({
                phrase: String(await v.lastSpokenPhrase()).slice(0, 160),
                href: a && a.getAttribute('href') ? a.href : '',
                isSubmit:
                  !!a &&
                  ((a.tagName === 'BUTTON' && ((a.getAttribute('type') || '') === 'submit' || (!a.getAttribute('type') && !!a.form))) ||
                    (a.tagName === 'INPUT' && /submit/.test(a.type))),
                expanded: a ? a.getAttribute('aria-expanded') : null,
                ref: window.__nodes.length - 1,
              });
            }
            return out;
          },
          { ref, max: mx },
        )
        .catch(() => []);
      return down.map((x) => ({ ...x, ...parsePhrase(x.phrase) }));
    };
    // 1) headings (H key) — most common first move (WebAIM SR surveys)
    const heads = await scan('moveToNextHeading', 40);
    j.note(
      `H x${heads.length}: ${
        heads
          .slice(0, 6)
          .map((h) => `"${h.name}"`)
          .join(', ') || 'no headings'
      }`,
    );
    if (!heads.length) {
      j.issue('SR-NO-HEADINGS', '1.3.1/2.4.1', 'medium', 'no headings to jump between');
      j.frustrate(1, 'no headings');
    }
    const hs = heads
      .map((h, i) => ({
        h,
        i,
        s: scoreItem({ name: h.name, role: 'link' }, { perceiveHint: false }).score + (TARGET && TARGET.test(h.name) ? 20 : 0),
      }))
      .filter((x) => x.s >= 50)[0];
    charge(heads, hs ? hs.i + 1 : heads.length);
    if (hs) {
      j.note(`heading "${hs.h.name}" sounds right; reading down from it`);
      const r = await tryItems(await readFrom(hs.h.ref, 25), `reading down from heading "${hs.h.name}"`);
      if (r === true) break;
      if (r === 'nav') continue pageLoop;
    }
    // 2) landmarks: navigation first
    const lms = await scan('moveToNextLandmark', 15);
    j.note(`landmarks x${lms.length}: ${lms.map((l) => l.role + (l.name ? ' ' + l.name : '')).join(', ') || 'none'}`);
    const navLm = lms.find((l) => l.role === 'navigation');
    charge(lms, navLm ? lms.indexOf(navLm) + 1 : lms.length);
    if (navLm) {
      const inside = await readFrom(navLm.ref, 30);
      const r0 = await tryItems(inside, 'reading the navigation landmark');
      if (r0 === true) break;
      if (r0 === 'nav') continue;
      if (r0 === 'expanded') {
        const again = await readFrom(navLm.ref, 40);
        const r1 = await tryItems(again, 'navigation after opening a menu');
        if (r1 === true) break;
        if (r1 === 'nav') continue;
      }
    }
    if (!lms.length) {
      j.issue('SR-NO-LANDMARKS', '1.3.1/2.4.1', 'low', 'no landmarks (navigation, main) to jump to');
      j.frustrate(0.5, 'no landmarks');
    }
    // 3) links list (Insert+F7 / rotor)
    const links = await scan('moveToNextLink', 150);
    const unnamed = links.filter((l) => !l.name || /^[\w\-./:?=&#]+\.(html?|php|aspx?)$|^https?:/.test(l.name));
    j.note(`links list x${links.length}${unnamed.length ? `, ${unnamed.length} with no usable name` : ''}`);
    let r = await tryItems(links, 'links list');
    if (r === true) break;
    if (r === 'nav') continue;
    // 4) read down the whole page (catches buttons and collapsed menus)
    const all = await scan('next', 400);
    j.note(`read-down x${all.length} items`);
    r = await tryItems(all, 'reading the whole page');
    if (r === true) break;
    if (r === 'nav') continue;
    if (r === 'expanded') {
      const again = await scan('moveToNextLink', 150);
      r = await tryItems(again, 'links list after opening a menu');
      if (r === true) break;
      if (r === 'nav') continue;
    }
    // 5) guess unnamed links/buttons (what real users do when labels are missing)
    const blanks = all.filter((x) => (x.role === 'link' || x.role === 'button') && (!x.name || VAGUE.test(x.name)));
    if (blanks.length) {
      j.issue(
        'SR-MUST-GUESS',
        '4.1.2/2.4.4/1.1.1',
        'high',
        `${blanks.length} link(s)/button(s) announced with no meaningful name ("${blanks[0].phrase}"); the user has to guess`,
      );
      j.frustrate(2, `${blanks.length} unlabelled controls; guessing`);
      const g = blanks.find((x) => x.href && safeFollow(x.href, page.url()) && guesses < 2);
      if (g) {
        guesses++;
        j.note(`guess #${guesses}: activates unnamed "${g.phrase}" (${g.href.replace(/^https?:\/\/[^/]+/, '')})`);
        await go(page, g.href);
        j.pages.push(page.url());
        continue;
      }
    }
    // hidden goal links: exist in DOM but not in the accessibility tree (hover-only menus)
    const hid = await page.evaluate(() => {
      const shown = new Set(
        [...document.querySelectorAll('a[href]')]
          .filter((a) => a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden')
          .map((a) => a.href),
      );
      return [...document.querySelectorAll('nav a[href],header a[href]')]
        .filter((a) => !shown.has(a.href))
        .filter(
          (a) => (!a.getClientRects().length || getComputedStyle(a).visibility === 'hidden') && !a.closest('[aria-modal],[role=dialog]'),
        )
        .filter((a) => {
          for (let x = a.parentElement; x && x !== document.body; x = x.parentElement) {
            const trig = [...x.querySelectorAll('button,[aria-expanded],summary,[aria-haspopup]')].find(
              (t) => t.getClientRects().length && t.tabIndex >= 0,
            );
            if (trig) return false;
            if (x.matches('li,nav,header')) break;
          }
          const det = a.closest('details');
          return !det;
        })
        .map((a) => (a.innerText || a.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 8);
    });
    if (hid.length) j.issue('SR-HIDDEN-MENU', '2.1.1/4.1.2', 'medium', `menu links never exposed to the screen reader: ${hid.join(', ')}`);
    await j.shot(page, 'not-found');
    j.done('gave up', `no heading, landmark, link or button announced anything like "${GOAL}"`);
    break;
  }
  if (!j.outcome) j.done('gave up', `page limit (${MAXP}) reached`);
  if (guesses && j.outcome === 'reached') j.reasons.push(`only after ${guesses} blind guess(es)`);
  j.baseline = bestIdx.length ? bestIdx.reduce((a, b) => a + Math.min(b, 10), 0) : null;
  j.keys = cmds;
  if (blockedWrites.length) j.note(`blocked writes: ${blockedWrites.join(' | ')}`);
  await browser.close();
  return j;
}

// ---------- persona: low vision / zoom (320 CSS px + 200% text) ----------
async function zoomPersona(url, d) {
  const j = new Journey('zoom', url, d);
  const { browser, page } = await safePage(args, { width: 320, height: 640 });
  await armGuard(page, j);
  const bigText = async () => {
    await page
      .evaluate(() => {
        const all = [...document.querySelectorAll('body, body *')].filter((e) => !e.dataset.z);
        const sizes = all.map((e) => parseFloat(getComputedStyle(e).fontSize));
        all.forEach((e, i) => {
          if (sizes[i]) {
            e.dataset.z = 1;
            e.style.setProperty('font-size', sizes[i] * 2 + 'px', 'important');
          }
        });
      })
      .catch(() => {});
    await sleep(400);
  };
  await go(page, url);
  let sw0 = await page.evaluate(() => document.documentElement.scrollWidth);
  await bigText();
  const tapped = new Set();
  for (let pg = 0; pg < MAXP && !j.outcome; pg++) {
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      w: innerWidth,
      h: document.documentElement.scrollHeight,
    }));
    if (sw0 > m.w + 4) {
      const sh = await j.shot(page, 'horizontal-scroll');
      j.issue('ZOOM-HSCROLL', '1.4.10', 'medium', `page is ${sw0}px wide at 320 CSS px (= 400% zoom): two-direction scrolling`, {
        shot: sh,
      });
      j.frustrate(1, 'has to scroll sideways');
    } else if (m.sw > m.w + 4) {
      j.issue(
        'ZOOM-HSCROLL-BIGTEXT',
        'beyond 1.4.4/1.4.10 minimum (advisory)',
        'low',
        `fits at 320px, but with text also at 200% the page is ${m.sw}px wide`,
      );
      j.frustrate(0.5, 'some sideways scrolling with big text');
    }
    if ((await page.evaluate(OVERLAYS)).some((o) => o.modal)) await dismissModal(page, j, 'zoom');
    const ov = await page.evaluate(OVERLAYS);
    for (const o of ov.filter((o) => o.cover >= 35)) {
      const sh = await j.shot(page, 'overlay');
      j.issue(
        'ZOOM-OVERLAY',
        '1.4.10/2.4.11',
        o.cover >= 50 ? 'high' : 'medium',
        `${o.el} covers ${o.cover}% of the zoomed screen ("${o.text}")`,
        { shot: sh },
      );
      j.frustrate(1, `${o.el} hides most of the screen`);
    }
    let found = null;
    const screens = Math.min(12, Math.ceil(m.h / 640));
    for (let sI = 0; sI < screens && !found; sI++) {
      await page.evaluate((y) => scrollTo(0, y), sI * 544);
      await sleep(150);
      j.steps++;
      j.keys++;
      const vis = (await page.evaluate(SEEN))
        .filter((x) => x.inView && !tapped.has(x.name))
        .map((x) => ({ ...x, ...scoreItem(x) }))
        .filter((x) => x.score >= 50 && (x.terminal || (x.href ? safeFollow(x.href, page.url()) : x.role === 'button')))
        .sort((a, b) => b.score - a.score);
      j.sim += 1.5 + (vis.length ? 1 : 2.5);
      if (vis.length) found = { ...vis[0], screen: sI + 1 };
    }
    if (!found) {
      // try the menu
      const tog = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button,[role=button],[aria-expanded]')].find(
          (e) =>
            e.getClientRects().length &&
            /menu|☰|navigation|shop/i.test((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')) &&
            !(e.form && e.type === 'submit'),
        );
        if (!b) return null;
        b.setAttribute('data-zt', '1');
        return (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40);
      });
      if (tog) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.click('[data-zt="1"]', { timeout: 3000 }).catch(() => {});
        await sleep(500);
        j.steps++;
        j.note(`opens menu "${tog}"`);
        const vis = (await page.evaluate(SEEN))
          .map((x) => ({ ...x, ...scoreItem(x) }))
          .filter((x) => x.score >= 50)
          .sort((a, b) => b.score - a.score);
        if (vis.length) found = { ...vis[0], screen: 'menu' };
      }
    }
    if (!found) {
      await j.shot(page, 'not-found');
      j.done('gave up', `nothing like "${GOAL}" found in ${screens} zoomed screens or the menu`);
      break;
    }
    // check the found target as a low-vision user sees it
    const chk = await page.evaluate(({ x, y, w, h }) => {
      scrollTo(0, Math.max(0, y - 200));
      const r = { left: x - scrollX, top: y - scrollY, right: x - scrollX + w, bottom: y - scrollY + h };
      const t = document.elementFromPoint(
        Math.min(Math.max(r.left + w / 2, 1), innerWidth - 1),
        Math.min(Math.max(r.top + h / 2, 1), innerHeight - 1),
      );
      return { clipped: r.right > innerWidth + 1 || r.left < -1, covered: t ? t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') : null };
    }, found.rect);
    j.note(`sees "${found.name || found.hint.slice(0, 30)}" on screen ${found.screen}${chk.clipped ? ' (cut off at the edge)' : ''}`);
    if (chk.clipped) {
      const sh = await j.shot(page, 'target-clipped');
      j.issue('ZOOM-TARGET-CLIPPED', '1.4.10', 'high', `"${found.name}" is cut off at 320px`, { shot: sh });
    }
    if (found.terminal) {
      await j.shot(page, 'reached');
      j.done('reached', `final control "${found.name}" visible on zoomed screen ${found.screen} (not activated)`);
      break;
    }
    if (found.href && safeFollow(found.href, page.url())) {
      await go(page, found.href);
      sw0 = await page.evaluate(() => document.documentElement.scrollWidth);
      await bigText();
      j.pages.push(page.url());
      j.note(`taps "${found.name || found.hint.slice(0, 30)}" → ${page.url()}`);
      continue;
    }
    if (!found.href && found.role === 'button' && !found.isSubmit && !tapped.has(found.name)) {
      tapped.add(found.name);
      const pt = await page.evaluate(({ x, y, w, h }) => {
        scrollTo(0, Math.max(0, y - 200));
        return { x: x - scrollX + w / 2, y: y - scrollY + h / 2 };
      }, found.rect);
      await page.mouse.click(pt.x, pt.y);
      await sleep(600);
      j.steps++;
      j.note(`taps "${found.name}" (opens it)`);
      pg--;
      continue;
    }
    j.done('gave up', `"${found.name}" found but it does not lead anywhere it can follow`);
  }
  if (!j.outcome) j.done('gave up', `page limit (${MAXP}) reached`);
  j.baseline = j.pages.length;
  await browser.close();
  return j;
}

// ---------- persona: tremor / motor ----------
async function tremorPersona(url, d) {
  const j = new Journey('tremor', url, d);
  const SIG = Number(args.tremor || 6);
  for (const vp of [
    { width: 390, height: 844, label: 'mobile' },
    { width: 1280, height: 800, label: 'desktop' },
  ]) {
    const { browser, page } = await safePage(args, vp);
    await armGuard(page, j);
    await go(page, url);
    await dismissModal(page, j, vp.label);
    // path targets = goal-like controls + everything within 48px of them
    const items = (await page.evaluate(SEEN)).map((x) => ({ ...x, ...scoreItem(x) }));
    const goals = items.filter((x) => x.score >= 50).slice(0, 6);
    if (!goals.length) j.note(`${vp.label}: no goal-like control on the first page; checking nav items instead`);
    let targets = goals.length ? goals : items.filter((x) => x.rect.y < 200).slice(0, 8);
    const near48 = (a, b) =>
      Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0) < 48 && Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0) < 48;
    if (goals.length)
      targets = [
        ...goals,
        ...items.filter((x) => !goals.includes(x) && x.inter !== false && x.rect && goals.some((g) => g.rect && near48(x.rect, g.rect))),
      ].slice(0, 12);
    for (const t of targets) {
      // Monte Carlo near-miss: Gaussian jitter around the centre, what would the pointer land on?
      const res = await page.evaluate(
        ({ jid, n, sig, seed }) => {
          let a = seed >>> 0;
          const rnd = () => {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
          const g = () => {
            let u = 0,
              v = 0;
            while (!u) u = rnd();
            while (!v) v = rnd();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
          };
          const target = document.querySelector(`[data-jid="${jid}"]`);
          if (!target) return null;
          target.scrollIntoView({ block: 'center' });
          const R = target.getBoundingClientRect();
          const rect = { w: Math.round(R.width), h: Math.round(R.height) };
          const cx = R.left + R.width / 2,
            cy = R.top + R.height / 2;
          const ctl = (el) =>
            el && el.closest('a[href],button,[role=button],input,select,textarea,summary,[onclick],[role=link],[role=menuitem]');
          const atC = document.elementFromPoint(cx, cy);
          const covered =
            !!atC && atC !== target && !target.contains(atC) && !atC.contains(target)
              ? atC.tagName.toLowerCase() + (atC.id ? '#' + atC.id : '')
              : null;
          let hit = 0,
            miss = 0;
          const nb = {};
          for (let i = 0; i < n; i++) {
            const x = cx + g() * sig,
              y = cy + g() * sig;
            const c = ctl(document.elementFromPoint(x, y));
            if (c && (c === target || ((c.innerText || '').trim() && (c.innerText || '').trim() === (target.innerText || '').trim())))
              hit++; /* same-label twin (summary+link) = same target */
            else if (c) {
              const k = (c.innerText || c.getAttribute('aria-label') || c.tagName).trim().slice(0, 30);
              nb[k] = (nb[k] || 0) + 1;
            } else miss++;
          }
          // 2.5.8 spacing: 24px circle on each undersized target must not intersect another target or its circle
          // WCAG 2.5.8 spacing test: a 24px-diameter circle on the undersized target's centre must not intersect another target, or the circle of another undersized target
          const others = [...document.querySelectorAll('a[href],button,[role=button],input:not([type=hidden]),select,summary')]
            .filter((e) => e !== target && !target.contains(e) && !e.contains(target) && e.getClientRects().length)
            .map((e) => e.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0);
          const near = others.filter((r) => {
            const dx = Math.max(r.left - cx, 0, cx - r.right),
              dy = Math.max(r.top - cy, 0, cy - r.bottom);
            if (Math.hypot(dx, dy) < 12) return true;
            const small = Math.min(r.width, r.height) < 24;
            return small && Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy) < 24;
          }).length;
          return { hit, miss, nb, near, w: rect.w, h: rect.h, covered };
        },
        { jid: t.jid, n: 300, sig: SIG, seed: SEED + hash(t.name) },
      );
      if (!res) continue;
      if (res.covered) {
        j.note(`${vp.label}: "${t.name}" is under ${res.covered}; a tap would hit that instead`);
        j.issue('TARGET-COVERED', '2.4.11/2.5.8', 'medium', `${vp.label}: "${t.name || t.tag}" is covered by ${res.covered}`);
      }
      const nbTot = Object.values(res.nb).reduce((a, b) => a + b, 0);
      const nbPct = Math.round((100 * nbTot) / 300),
        hitPct = Math.round((100 * res.hit) / 300);
      const small = Math.min(res.w, res.h) < 24;
      const top = Object.entries(res.nb).sort((a, b) => b[1] - a[1])[0];
      j.note(
        `${vp.label}: "${t.name || t.hint.slice(0, 30)}" ${res.w}×${res.h}px: lands on target ${hitPct}%, on a neighbour ${nbPct}%${top ? ` (mostly "${top[0]}")` : ''}, on nothing ${100 - hitPct - nbPct}% (σ=${SIG}px)`,
      );
      j.steps++;
      if (small && t.inline) j.note(`${vp.label}: "${t.name}" is a link inside a sentence (2.5.8 inline exception)`);
      else if (small && res.near)
        j.issue(
          'TARGET-TOO-SMALL',
          '2.5.8',
          'high',
          `${vp.label}: "${t.name || t.tag}" is ${res.w}×${res.h}px with another control inside its 24px spacing circle`,
        );
      else if (small)
        j.issue(
          'TARGET-SMALL-SPACED',
          '2.5.8 (spacing exception?) / 2.5.5 AAA',
          'low',
          `${vp.label}: "${t.name || t.tag}" is ${res.w}×${res.h}px but spaced from neighbours`,
        );
      if (nbPct >= 10 && !t.inline)
        j.issue(
          'ACCIDENTAL-ACTIVATION-RISK',
          '2.5.8/2.5.2',
          nbPct >= 25 ? 'high' : 'medium',
          `${vp.label}: ${nbPct}% of shaky taps on "${t.name || t.tag}" would hit "${top[0]}"`,
        );
      else if (hitPct < 60 && goals.length && !t.inline)
        j.issue('HARD-TO-HIT', '2.5.8/2.5.5', 'low', `${vp.label}: only ${hitPct}% of shaky taps land on "${t.name || t.tag}"`);
    }
    if (vp.label === 'desktop') {
      // hover-only menus: hover reveals links that focus/click don't
      const tops = await page.evaluate(() => {
        const c = [...document.querySelectorAll('nav li, header li, [role=menubar] > *')]
          .filter((li) => li.querySelector('ul,div,[role=menu]') && li.getClientRects().length)
          .slice(0, 10);
        c.forEach((li, i) => li.setAttribute('data-hv', i));
        return c.length;
      });
      for (let i = 0; i < tops; i++) {
        const cnt = () =>
          page.evaluate((i) => {
            const li = document.querySelector(`[data-hv="${i}"]`);
            return [...li.querySelectorAll('a[href],button')].filter(
              (a) => a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden',
            ).length;
          }, i);
        await page.mouse.move(5, 790);
        await sleep(200);
        const base = await cnt();
        const box = await page.evaluate((i) => {
          const li = document.querySelector(`[data-hv="${i}"]`);
          const r = li.getBoundingClientRect();
          return {
            x: r.x + Math.min(r.width / 2, 30),
            y: r.y + Math.min(r.height / 2, 12),
            label: (li.firstElementChild?.innerText || li.innerText || '').trim().split('\n')[0].slice(0, 30),
          };
        }, i);
        await page.mouse.move(box.x, box.y, { steps: 5 });
        await sleep(400);
        const hov = await cnt();
        if (hov <= base) continue;
        await page.mouse.move(5, 790);
        await sleep(300);
        const viaFocus = await page.evaluate((i) => {
          const li = document.querySelector(`[data-hv="${i}"]`);
          const f = li.querySelector('a[href],button,[tabindex]');
          if (!f) return -1;
          f.focus();
          return [...li.querySelectorAll('a[href],button')].filter(
            (a) => a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden',
          ).length;
        }, i);
        const focusable = viaFocus >= 0;
        // drift test: move from trigger toward first submenu link with tremor; does the menu close mid-way?
        await page.mouse.move(box.x, box.y);
        await sleep(300);
        const sub = await page.evaluate((i) => {
          const li = document.querySelector(`[data-hv="${i}"]`);
          const a = [...li.querySelectorAll('a[href]')].find(
            (a) => a.getClientRects().length && a.getBoundingClientRect().top > 0 && a !== li.querySelector('a'),
          );
          if (!a) return null;
          const r = a.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }, i);
        let closedAt = null;
        if (sub)
          for (let k = 1; k <= 8; k++) {
            const x = box.x + ((sub.x - box.x) * k) / 8 + gauss(j.rng) * SIG * 2,
              y = box.y + ((sub.y - box.y) * k) / 8 + gauss(j.rng) * SIG;
            await page.mouse.move(x, y);
            await sleep(120);
            if ((await cnt()) <= base) {
              closedAt = k;
              break;
            }
          }
        if (!focusable || viaFocus <= base) {
          const sh = await j.shot(page, 'hover-only-menu');
          j.issue(
            'HOVER-ONLY-MENU',
            '2.1.1/1.4.13',
            'high',
            `"${box.label}" shows ${hov - base} links on hover only; keyboard focus does not open it`,
            { shot: sh },
          );
        }
        if (closedAt)
          j.issue(
            'MENU-CLOSES-ON-DRIFT',
            '1.4.13',
            'medium',
            `"${box.label}" menu closed when a shaky pointer drifted ${closedAt}/8 of the way to its first link`,
          );
      }
      const drag = await page.evaluate(() => {
        const s = [
          ...document.querySelectorAll(
            '[draggable=true],input[type=range],[role=slider],.swiper,.slick-slider,.flickity-enabled,.splide,.glide',
          ),
        ].filter((e) => e.getClientRects().length);
        return s.map((e) => ({
          el: e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className.split(' ')[0] : ''),
          buttons: !!(e.parentElement || e).querySelector('button,[role=button],[class*=prev],[class*=next],[class*=arrow]'),
        }));
      });
      for (const dr of drag.filter((x) => !x.buttons))
        j.issue('DRAG-ONLY?', '2.5.7', 'medium', `${dr.el} looks drag/swipe-operated with no buttons next to it`);
    }
    await browser.close();
  }
  j.done(j.issues.some((i) => i.conf === 'high') ? 'at risk' : 'ok', `${j.issues.length} motor-access candidate(s) on the path`);
  return j;
}
// ---------- persona: hurried / cognitive ----------
async function hurriedPersona(url, d) {
  const j = new Journey('hurried', url, d);
  const { browser, page } = await safePage(args, { width: 390, height: 844 });
  await armGuard(page, j);
  await go(page, url);
  await trackFocus(page);
  await page.evaluate(() => {
    window.__mut = [];
    window.__foc = [];
    const t0 = performance.now();
    new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!el || el.closest('script,style')) continue;
        const box =
          el.closest(
            'section,[class*=carousel],[class*=slider],[class*=slide],[class*=hero],[class*=banner],[aria-roledescription],[role=region],[class*=marquee],[class*=ticker]',
          ) || el;
        const k =
          box.tagName.toLowerCase() +
          (box.id ? '#' + box.id : '') +
          (typeof box.className === 'string' && box.className.trim() ? '.' + box.className.trim().split(/\s+/)[0] : '');
        window.__mut.push({ k, t: performance.now() - t0, attr: m.attributeName || '' });
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'],
      characterData: true,
    });
    document.addEventListener(
      'focusin',
      (e) => window.__foc.push({ t: performance.now() - t0, el: (e.target.innerText || e.target.tagName).trim().slice(0, 40) }),
      true,
    );
  });
  // what does a hurried person read first?
  const first = (await page.evaluate(SEEN)).filter((x) => x.inView).map((x) => ({ ...x, ...scoreItem(x) }));
  const goalNow = first.filter((x) => x.score >= 50).sort((a, b) => b.score - a.score)[0];
  j.note(goalNow ? `first screen: spots "${goalNow.name}" within ~2s` : 'first screen: nothing obviously leads to the goal');
  const vague = first.filter((x) => (x.role === 'link' || x.role === 'button') && x.name && VAGUE.test(x.name)).map((x) => x.name);
  if (vague.length >= 2)
    j.issue('VAGUE-LINKS-ON-PATH', '2.4.4', 'low', `first screen has vague links: ${[...new Set(vague)].slice(0, 5).join(', ')}`);
  // watch without input for WATCH seconds (sampled), like someone reading slowly
  const ticks = Math.max(4, Math.round(WATCH / 2));
  let goalGone = false;
  const ov0 = (await page.evaluate(OVERLAYS)).length;
  for (let i = 0; i < ticks; i++) {
    await sleep(2000);
    j.sim += 2;
    j.steps++;
    if (goalNow && !goalGone) {
      const still = (await page.evaluate(SEEN)).some((x) => x.inView && x.name === goalNow.name);
      if (!still) {
        goalGone = true;
        const sh = await j.shot(page, 'goal-moved');
        j.issue(
          'TARGET-MOVED-AWAY',
          '2.2.2',
          'high',
          `"${goalNow.name}" disappeared after ~${(i + 1) * 2}s without any input (auto-advancing content?)`,
          { shot: sh },
        );
        j.frustrate(3, `"${goalNow.name}" vanished while reading`);
      }
    }
    const ov = await page.evaluate(OVERLAYS);
    if (ov.length > ov0) {
      const sh = await j.shot(page, 'interruption');
      j.issue(
        'INTERRUPTION',
        '2.2.4 (AAA)/3.2.5 (AAA)',
        'low',
        `${ov[ov.length - 1].el} popped up after ~${(i + 1) * 2}s covering ${ov[ov.length - 1].cover}%`,
        { shot: sh },
      );
    }
  }
  const { mut, foc } = await page.evaluate(() => ({ mut: window.__mut, foc: window.__foc }));
  const byK = {};
  for (const m of mut) (byK[m.k] = byK[m.k] || []).push(m.t);
  for (const [k, ts] of Object.entries(byK)) {
    const bursts = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 900);
    if (bursts.length >= 3 && ts[ts.length - 1] > 5000) {
      const pause = await page.evaluate(() =>
        [...document.querySelectorAll('button,[role=button],a')].some(
          (b) => /pause|stop|play/i.test((b.innerText || '') + (b.getAttribute('aria-label') || '')) && b.getClientRects().length,
        ),
      );
      const gap = Math.round((bursts[bursts.length - 1] - bursts[0]) / (bursts.length - 1) / 100) / 10;
      j.issue(
        'AUTO-ADVANCE',
        '2.2.2',
        pause ? 'low' : 'high',
        `${k} changes by itself about every ${gap}s${pause ? ' (a pause/stop control exists)' : ' with no pause/stop control'}`,
      );
    }
  }
  const stolen = foc.filter((f) => f.t > 1500);
  if (stolen.length)
    j.issue(
      'FOCUS-MOVED-BY-ITSELF',
      '3.2.1/2.4.3',
      'high',
      `focus moved ${stolen.length} time(s) with no input (e.g. to "${stolen[0].el}")`,
    );
  if (page.__unexpected.length) {
    j.issue(
      'TIMED-NAVIGATION',
      '2.2.1/3.2.5',
      'high',
      `page tried to navigate by itself to ${page.__unexpected[0]} (blocked) — no warning or extend option seen`,
    );
    j.frustrate(4, 'page tried to leave by itself');
  }
  const timerText = await page.evaluate(() =>
    /session (will )?(expire|time ?out)|time (is )?running out|minutes? remaining|you will be logged out/i.test(document.body.innerText),
  );
  if (timerText) j.issue('TIME-LIMIT-TEXT', '2.2.1', 'low', 'page mentions a time limit; check it can be turned off, adjusted or extended');
  j.done(j.issues.some((i) => i.conf === 'high') ? 'at risk' : 'ok', `${j.issues.length} time/attention candidate(s)`);
  await browser.close();
  return j;
}

// ---------- main ----------
const RUN = { keyboard: keyboardPersona, sr: srPersona, zoom: zoomPersona, tremor: tremorPersona, hurried: hurriedPersona };
const summary = ['url\tpersona\toutcome\tsteps\tkeys/commands\tsim_seconds\tbaseline\tfriction\tissues'];
for (const url of urls) {
  const d = path.join(dirRoot, slug(url));
  fs.mkdirSync(d, { recursive: true });
  const res = [];
  for (const p of PERSONAS) {
    if (!RUN[p]) continue;
    let j;
    try {
      j = await RUN[p](url, d);
    } catch (e) {
      j = new Journey(p, url, d);
      j.done('error', e.message.split('\n')[0]);
    }
    res.push(j);
  }
  const fr = (j) => (j.baseline && j.outcome === 'reached' ? (j.keys / j.baseline).toFixed(1) + 'x' : '-');
  const narr = (j) => {
    const who = {
      keyboard: 'Keyboard-only user',
      sr: 'Screen-reader user (simulated)',
      zoom: 'Low-vision user at 320px + 200% text',
      tremor: 'Tremor/motor user',
      hurried: 'Hurried/cognitive user',
    }[j.persona];
    const top = j.issues
      .filter((i) => i.conf !== 'low')
      .slice(0, 2)
      .map((i) => i.detail);
    if (j.persona === 'tremor' || j.persona === 'hurried') return `${who}: ${j.outcome}. ${top.join('; ') || 'nothing notable'}.`;
    return `${who}: ${j.outcome === 'reached' ? `reached the goal in ${j.steps} steps (${j.keys} ${j.persona === 'sr' ? 'SR commands' : 'keys'}, ~${Math.round(j.sim)}s simulated; efficient path ≈${j.baseline ?? '?'}, friction ${fr(j)})` : `${j.outcome} after ${j.steps} steps (~${Math.round(j.sim)}s): ${j.reasons[0]}`}${j.reasons.length > 1 ? ' — ' + j.reasons.slice(1).join('; ') : ''}${top.length ? '. Seen: ' + top.join('; ') : ''}.`;
  };
  const out = [
    BANNER,
    header('journeys', `${url} goal=${GOAL}${TARGET ? ' target=' + args.target : ''} seed=${SEED}`),
    '## Narratives',
    ...res.map(narr),
    '',
    '## Candidates (persona · code · WCAG · confidence · detail)',
  ];
  for (const j of res)
    for (const i of j.issues) out.push(`${j.persona}\t${i.code}\t${i.sc}\t${i.conf}\t${i.detail}${i.shot ? `\t[${i.shot}]` : ''}`);
  for (const j of res) {
    out.push('', `## Step log: ${j.persona} (pages: ${j.pages.join(' → ')})`, ...j.log);
    if (j.shots.length) out.push(`screenshots: ${j.shots.join(', ')}`);
  }
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dirRoot, slug(url) + '.txt'), out.join('\n') + '\n');
  writeJSON(
    path.join(d, 'journeys.json'),
    res.map((j) => ({
      persona: j.persona,
      outcome: j.outcome,
      reasons: j.reasons,
      steps: j.steps,
      keys: j.keys,
      simSeconds: Math.round(j.sim),
      baseline: j.baseline,
      pages: j.pages,
      issues: j.issues,
      shots: j.shots,
      frustration: j.frustration,
      log: j.log,
    })),
  );
  for (const j of res)
    summary.push(
      [
        url,
        j.persona,
        j.outcome,
        j.steps,
        j.keys,
        Math.round(j.sim),
        j.baseline ?? '',
        fr(j),
        j.issues.map((i) => `${i.code}(${i.conf})`).join(' '),
      ].join('\t'),
    );
  console.log(`${url}\n  ` + res.map(narr).join('\n  '));
}
fs.mkdirSync(dirRoot, { recursive: true });
fs.appendFileSync(path.join(dirRoot, 'summary.tsv'), summary.join('\n') + '\n');
