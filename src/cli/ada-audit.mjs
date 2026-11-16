// ada-audit: unified CLI. `ada-audit <url...>` runs the read-only tool suite in parallel on one shared browser,
// then writes findings.json (schema v1), report.md, report.html (+ optional SARIF/CSV).
// Exit codes: 0 ok · 1 findings at/above --fail-on · 2 usage/config error · 3 runtime error (tool or browser failed).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { TOOLS, toolByName } from '../tools/registry.mjs';
import { startBrowser, pool, runJob, mergeShard, defaultConcurrency } from '../core/runner.mjs';
import { buildDocument } from '../findings/document.mjs';
import { writeReports, FORMATS } from '../report/index.mjs';
import { validateDocument } from '../findings/validate.mjs';
import { RULES } from '../findings/rules.mjs';
import { slug } from '../core/lib.mjs';
import { srMain } from './sr.mjs';

const require = createRequire(import.meta.url);
const ver = (p) => {
  try {
    return require(`${p}/package.json`).version;
  } catch {
    return null;
  }
};
export const VERSION = require('../../package.json').version;
export const EXIT = { OK: 0, FINDINGS: 1, USAGE: 2, RUNTIME: 3 };
const SEV = ['blocker', 'critical', 'serious', 'moderate', 'minor'];
const PLATFORMS = ['wordpress', 'shopify', 'webflow', 'framer', 'squarespace', 'wix', 'react'];

const HELP = `ada-audit ${VERSION} — read-only WCAG 2.2 AA audit helper (candidates, not a certification)

Usage:
  ada-audit [run] <url...> [options]     run the tools, then write findings + reports
  ada-audit report <dir> [options]       rebuild findings + reports from an existing output folder
  ada-audit validate <findings.json>     check a findings file against schema v1
  ada-audit sr --url <url> [--journey f] record a REAL screen-reader transcript (NVDA/VoiceOver; see ada-audit sr --help)
  ada-audit tools | rules [--json]       list tools / the rule catalog

Options:
  --urls <file|a,b>        URL list (file: one per line, # comments) in addition to positional URLs
  -c, --config <file>      JSON config (see docs/configuration.md); CLI flags win
  -o, --out <dir>          output folder (default ./audit-output)
  --tools <list|all>       comma list (default: the default set; see \`ada-audit tools\`)
  --skip <list>            tools to leave out
  --widths <390,1440>      viewport widths (mobile first)
  --journeys               also run simulated persona journeys (--goal buy|checkout|contact|donate|book, --target text, --personas list)
  --journey "Name=url,url" name a critical journey (repeatable); pages not named are lower priority
  --focus-selector <css>   run focus-state on these selectors;  --trigger <css>  run menu-modal on this trigger
  --try-empty-submit       forms: press submit on empty forms (navigations and non-GET requests are blocked)
  --platform <name>        put fix hints for wordpress|shopify|webflow|framer|squarespace|wix|react first
  --format <list>          json,md,html,sarif,csv (default json,md,html)
  --concurrency <n>        parallel tool jobs (default ${defaultConcurrency()})
  --timeout <ms>           per navigation (default 90000);  --job-timeout <ms> per tool job (default 600000)
  --retries <n>            navigation retries (default 2); a crashed job is retried once
  --fail-on <severity>     exit 1 if a WCAG failure at/above blocker|critical|serious|moderate|minor is found
  --channel chrome         use installed Chrome instead of bundled Chromium
  -q, --quiet              less output;  -h, --help;  -v, --version
`;

const OPTIONS = {
  urls: { type: 'string' },
  config: { type: 'string', short: 'c' },
  out: { type: 'string', short: 'o' },
  tools: { type: 'string' },
  skip: { type: 'string' },
  widths: { type: 'string' },
  journeys: { type: 'boolean' },
  journey: { type: 'string', multiple: true },
  goal: { type: 'string' },
  target: { type: 'string' },
  personas: { type: 'string' },
  'focus-selector': { type: 'string' },
  trigger: { type: 'string' },
  'try-empty-submit': { type: 'boolean' },
  platform: { type: 'string' },
  format: { type: 'string' },
  concurrency: { type: 'string' },
  timeout: { type: 'string' },
  'job-timeout': { type: 'string' },
  retries: { type: 'string' },
  'fail-on': { type: 'string' },
  channel: { type: 'string' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

export class UsageError extends Error {
  name = 'UsageError';
}
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

export function readUrlList(v) {
  if (!v) return [];
  const src = fs.existsSync(v) ? fs.readFileSync(v, 'utf8').split(/\r?\n/) : String(v).split(',');
  return src.map((s) => s.replace(/(^|\s)#.*$/, '').trim()).filter(Boolean);
}
function parseJourney(s) {
  const i = s.indexOf('=');
  if (i < 1) throw new UsageError(`--journey needs "Name=url,url" (got "${s}")`);
  return { name: s.slice(0, i).trim(), urls: list(s.slice(i + 1)) };
}

/** Merge config file + flags into one validated options object. */
export function resolveOptions(values, positionals) {
  let cfg = {};
  if (values.config) {
    if (!fs.existsSync(values.config)) throw new UsageError(`config not found: ${values.config}`);
    try {
      cfg = JSON.parse(fs.readFileSync(values.config, 'utf8'));
    } catch (e) {
      throw new UsageError(`config is not valid JSON: ${e.message}`);
    }
  }
  if (cfg.journeys !== undefined && !Array.isArray(cfg.journeys)) throw new UsageError('config "journeys" must be an array');
  const journeys = [...(cfg.journeys || []), ...(values.journey || []).map(parseJourney)];
  for (const j of journeys)
    if (!j || typeof j.name !== 'string' || !j.name.trim() || !Array.isArray(j.urls) || !j.urls.length)
      throw new UsageError('each journey needs a "name" and a non-empty "urls" array');
  // Journey pages are always audited, even if not listed in "urls".
  const urls = [...(cfg.urls || []), ...readUrlList(values.urls), ...positionals, ...journeys.flatMap((j) => j.urls)];
  for (const u of urls) {
    try {
      const x = new URL(u);
      if (!/^https?:$/.test(x.protocol)) throw 0;
    } catch {
      throw new UsageError(`not an http(s) URL: ${u}`);
    }
  }
  const o = {
    urls: [...new Set(urls)],
    out: values.out || cfg.out || './audit-output',
    widths: list(values.widths || cfg.widths || '390,1440').map(Number),
    journeys,
    runJourneys: !!(values.journeys ?? cfg.runJourneys),
    goal: values.goal || cfg.goal,
    target: values.target || cfg.target,
    personas: values.personas || cfg.personas,
    focusSelector: values['focus-selector'] || cfg.focusSelector,
    trigger: values.trigger || cfg.trigger,
    tryEmptySubmit: !!(values['try-empty-submit'] ?? cfg.tryEmptySubmit),
    platform: (values.platform || cfg.platform || '').toLowerCase() || null,
    formats: list(values.format || cfg.formats || 'json,md,html'),
    concurrency: Number(values.concurrency || cfg.concurrency || defaultConcurrency()),
    navTimeout: Number(values.timeout || cfg.timeouts?.navigation || 90000),
    jobTimeout: Number(values['job-timeout'] || cfg.timeouts?.job || 600000),
    retries: Number(values.retries ?? cfg.retries ?? 2),
    failOn: values['fail-on'] || cfg.failOn || null,
    channel: values.channel || cfg.channel || null,
    quiet: !!values.quiet,
  };
  if (o.widths.some((w) => !Number.isFinite(w) || w < 200 || w > 4000))
    throw new UsageError('--widths must be numbers between 200 and 4000');
  if (o.platform && !PLATFORMS.includes(o.platform)) throw new UsageError(`--platform must be one of ${PLATFORMS.join(', ')}`);
  for (const f of o.formats) if (!FORMATS[f]) throw new UsageError(`unknown format "${f}" (use ${Object.keys(FORMATS).join(',')})`);
  if (o.failOn && !SEV.includes(o.failOn)) throw new UsageError(`--fail-on must be one of ${SEV.join(', ')}`);
  const int = (v, lo, hi, name) => {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new UsageError(`${name} must be a whole number from ${lo} to ${hi}`);
  };
  int(o.concurrency, 1, 32, '--concurrency');
  int(o.navTimeout, 1000, 600000, '--timeout (ms)');
  int(o.jobTimeout, 10000, 7200000, '--job-timeout (ms)');
  int(o.retries, 0, 10, '--retries');
  const want = values.tools || cfg.tools;
  const tools =
    !want || want === 'default'
      ? TOOLS.filter((t) => t.default)
      : want === 'all'
        ? TOOLS.filter((t) => !t.needs)
        : list(want).map(
            (n) =>
              toolByName(n) ||
              (() => {
                throw new UsageError(`unknown tool "${n}" (see ada-audit tools)`);
              })(),
          );
  if (o.runJourneys && !tools.some((t) => t.name === 'journeys')) tools.push(toolByName('journeys'));
  if (o.focusSelector && !tools.some((t) => t.name === 'focus-state')) tools.push(toolByName('focus-state'));
  if (o.trigger && !tools.some((t) => t.name === 'menu-modal')) tools.push(toolByName('menu-modal'));
  const skip = new Set(list(values.skip || cfg.skip).map((n) => toolByName(n)?.name || n));
  o.tools = tools.filter((t) => !skip.has(t.name));
  if (o.tools.some((t) => t.name === 'focus-state') && !o.focusSelector) throw new UsageError('focus-state needs --focus-selector');
  if (o.tools.some((t) => t.name === 'menu-modal') && !o.trigger) throw new UsageError('menu-modal needs --trigger');
  return o;
}

/** Expand tools × URLs × arg-sets into jobs. Shardable tools get one job per URL in its own shard folder. */
export function planJobs(o) {
  const jobs = [];
  const shardRoot = path.join(o.out, '.shards');
  for (const t of o.tools) {
    if (t.minUrls && o.urls.length < t.minUrls) continue;
    let targets = o.urls;
    if (t.name === 'journeys' && o.journeys.length) targets = [...new Set(o.journeys.map((j) => j.urls[0]).filter(Boolean))];
    for (const [k, extra] of t.argsFor(o).entries()) {
      const groups = t.shard === 'url' ? targets.map((u) => [u]) : [targets];
      for (const g of groups) {
        const id = `${t.name}${t.argsFor(o).length > 1 ? '-' + k : ''}${t.shard === 'url' ? '-' + slug(g[0]).slice(-40) : ''}`;
        const out = t.shard === 'url' ? path.join(shardRoot, id) : o.out;
        const jg = t.name === 'journeys' ? o.journeys.find((j) => j.urls[0] === g[0]) : null;
        const jx = jg ? [...(jg.goal ? ['--goal', jg.goal] : []), ...(jg.target ? ['--target', jg.target] : [])] : [];
        jobs.push({
          id,
          tool: t.name,
          script: t.script,
          args: [
            '--urls',
            g.join(','),
            '--out',
            out,
            ...(jx.length
              ? jx.concat(extra.filter((a, i, arr) => !(['--goal', '--target'].includes(a) || ['--goal', '--target'].includes(arr[i - 1]))))
              : extra),
            ...(o.channel ? ['--channel', o.channel] : []),
          ],
          shard: t.shard === 'url' ? out : null,
          logFile: path.join(o.out, 'logs', `${id}.log`),
        });
      }
    }
  }
  // Long jobs first (journeys, sr-transcript) so the pool's tail is short.
  const weight = { journeys: 5, 'sr-transcript': 3, 'context-change': 3, 'tab-walk': 2, forms: 2 };
  return jobs.sort((a, b) => (weight[b.tool] || 1) - (weight[a.tool] || 1));
}

export function versions() {
  return {
    tool: VERSION,
    node: process.versions.node,
    playwright: ver('playwright'),
    axe: ver('axe-core'),
    vsr: ver('@guidepup/virtual-screen-reader'),
  };
}
const nowIso = () =>
  process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString() : new Date().toISOString();

export async function run(o, log = console.error) {
  if (!o.urls.length) throw new UsageError('give at least one URL (positional, --urls or config "urls")');
  fs.mkdirSync(o.out, { recursive: true });
  // Re-running into the same folder: clear the previous run's raw tool output so old candidates never leak into this report.
  if (fs.existsSync(path.join(o.out, 'run.json')))
    for (const d of [...new Set(TOOLS.map((t) => t.dir)), 'logs', '.shards'])
      fs.rmSync(path.join(o.out, d), { recursive: true, force: true });
  const startedAt = nowIso();
  const t0 = Date.now();
  const jobs = planJobs(o);
  if (!o.quiet)
    log(
      `ada-audit ${VERSION}: ${o.urls.length} page(s), ${o.tools.length} tool(s), ${jobs.length} job(s), concurrency ${o.concurrency}, read-only`,
    );
  const browser = await startBrowser({ channel: o.channel });
  const env = { ADA_BROWSER_WS: browser.wsEndpoint, ADA_NAV_TIMEOUT: String(o.navTimeout), ADA_NAV_RETRIES: String(o.retries) };
  let results;
  try {
    results = await pool(jobs, o.concurrency, async (j) => {
      const r = await runJob(j, { env, timeoutMs: o.jobTimeout, retries: 1 });
      if (!o.quiet)
        log(
          `${r.ok ? 'ok  ' : 'FAIL'} ${j.id} ${(r.ms / 1000).toFixed(1)}s${r.attempts > 1 ? ` (${r.attempts} attempts)` : ''}${r.ok ? '' : '\n' + r.tail}`,
        );
      return r;
    });
  } finally {
    await browser.close();
  }
  for (const j of jobs) if (j.shard) mergeShard(j.shard, o.out);
  fs.rmSync(path.join(o.out, '.shards'), { recursive: true, force: true });
  const finishedAt = nowIso();
  const runMeta = {
    startedAt,
    finishedAt,
    pages: o.urls,
    // Only tools that actually completed at least one job are listed as run.
    tools: o.tools.filter((t) => results.some((r) => r.tool === t.name && r.ok)).map((t) => t.name),
    widths: o.widths,
    versions: versions(),
    readOnly: true,
    platform: o.platform,
  };
  fs.writeFileSync(
    path.join(o.out, 'run.json'),
    JSON.stringify(
      {
        ...runMeta,
        journeys: o.journeys,
        wallMs: Date.now() - t0,
        concurrency: o.concurrency,
        jobs: results.map((r) => ({ id: r.id, tool: r.tool, ok: r.ok, code: r.code, ms: r.ms, attempts: r.attempts })),
      },
      null,
      2,
    ) + '\n',
  );
  const failed = results.filter((r) => !r.ok);
  const skipped = o.tools.filter((t) => !jobs.some((j) => j.tool === t.name)).map((t) => t.name);
  const errors = [
    ...failed.map(
      (r) =>
        `Tool job ${r.id} failed after ${r.attempts} attempt(s)${r.timedOut ? ' (timed out)' : ''}; its checks are missing from this report (log: logs/${r.id}.log).`,
    ),
    ...skipped.map((n) => `Tool ${n} was not run (it needs at least ${toolByName(n).minUrls || 1} pages).`),
  ];
  const doc = buildDocument(o.out, { run: runMeta, journeys: o.journeys, errors });
  const written = writeReports(doc, o.out, { formats: o.formats, platform: o.platform });
  if (!o.quiet)
    log(
      `done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${doc.summary.failures} candidate failure(s) (${doc.summary.byPlan['fix-now']} fix now), ${doc.summary.total - doc.summary.failures} other item(s)\n${Object.values(
        written,
      )
        .map((f) => '  ' + f)
        .join('\n')}`,
    );
  return { doc, written, failed, exitCode: failed.length ? EXIT.RUNTIME : gate(doc, o.failOn) };
}

export function gate(doc, failOn) {
  if (!failOn) return EXIT.OK;
  const lim = SEV.indexOf(failOn);
  return doc.findings.some((f) => f.kind === 'failure' && f.confidence !== 'inferred' && SEV.indexOf(f.severity) <= lim)
    ? EXIT.FINDINGS
    : EXIT.OK;
}

export async function main(argv = process.argv.slice(2), { stdout = (s) => process.stdout.write(s), log = console.error } = {}) {
  if (argv[0] === 'sr') return srMain(argv.slice(1), { stdout, log, EXIT });
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    if (values.version) {
      stdout(VERSION + '\n');
      return EXIT.OK;
    }
    const cmd = ['run', 'report', 'validate', 'tools', 'rules'].includes(positionals[0]) ? positionals.shift() : 'run';
    if (values.help || (cmd === 'run' && !positionals.length && !values.urls && !values.config)) {
      stdout(HELP);
      return values.help ? EXIT.OK : EXIT.USAGE;
    }
    if (cmd === 'tools') {
      stdout(
        values.json
          ? JSON.stringify(
              TOOLS.map(({ name, default: d, needs, describe }) => ({ name, default: d, needs: needs || null, describe })),
              null,
              2,
            ) + '\n'
          : TOOLS.map((t) => `${t.name.padEnd(15)} ${t.default ? 'default ' : (t.needs || '').padEnd(8)} ${t.describe}`).join('\n') + '\n',
      );
      return EXIT.OK;
    }
    if (cmd === 'rules') {
      stdout(
        values.json
          ? JSON.stringify(
              RULES.map(({ re, ...r }) => r),
              null,
              2,
            ) + '\n'
          : RULES.map(
              (r) =>
                `${r.id.padEnd(42)} ${(r.sc.join(',') || '-').padEnd(14)} ${r.kind.padEnd(13)} ${r.severity.padEnd(9)} ${r.confidence}`,
            ).join('\n') + '\n',
      );
      return EXIT.OK;
    }
    if (cmd === 'validate') {
      const f = positionals[0];
      if (!f || !fs.existsSync(f)) throw new UsageError('validate needs a findings.json path');
      const errs = validateDocument(JSON.parse(fs.readFileSync(f, 'utf8')));
      stdout(errs.length ? `invalid: ${errs.length} error(s)\n${errs.slice(0, 20).join('\n')}\n` : 'valid (findings schema v1)\n');
      return errs.length ? EXIT.FINDINGS : EXIT.OK;
    }
    if (cmd === 'report') {
      const dir = positionals[0];
      if (!dir || !fs.existsSync(dir)) throw new UsageError('report needs an output folder');
      const o = resolveOptions({ ...values, out: dir }, []);
      const meta = fs.existsSync(path.join(dir, 'run.json'))
        ? JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'))
        : { startedAt: nowIso(), finishedAt: nowIso(), versions: versions() };
      const { jobs, wallMs, concurrency, journeys, ...runMeta } = meta;
      const doc = buildDocument(dir, { run: runMeta, journeys: o.journeys.length ? o.journeys : journeys || [] });
      const written = writeReports(doc, dir, { formats: o.formats, platform: o.platform || meta.platform });
      if (!o.quiet)
        log(
          `${doc.summary.failures} candidate failure(s); wrote\n${Object.values(written)
            .map((x) => '  ' + x)
            .join('\n')}`,
        );
      return gate(doc, o.failOn);
    }
    const o = resolveOptions(values, positionals);
    const r = await run(o, log);
    return r.exitCode;
  } catch (e) {
    if (
      e instanceof UsageError ||
      e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ||
      e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' ||
      e.code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL'
    ) {
      log(`ada-audit: ${e.message}\nRun "ada-audit --help" for usage.`);
      return EXIT.USAGE;
    }
    log(`ada-audit: ${e.stack || e.message}`);
    return EXIT.RUNTIME;
  }
}
