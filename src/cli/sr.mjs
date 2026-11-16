// `ada-audit sr`: record a real screen-reader transcript (NVDA on Windows, VoiceOver on macOS) for a journey,
// then rebuild findings + reports for the output folder so real-screen-reader evidence joins the other tools.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadJourney, JourneyError, PASSES } from '../sr/journey.mjs';
import { resolveScreenReader, SrEnvironmentError } from '../sr/driver.mjs';
import { buildDocument } from '../findings/document.mjs';
import { writeReports, FORMATS } from '../report/index.mjs';

export const SR_HELP = `ada-audit sr — record a REAL screen-reader transcript for a journey (read-only)

Usage:
  ada-audit sr --url <url> [--url <url>...] [--journey <file.json>] [options]

Runs NVDA (Windows) or VoiceOver (macOS) through Guidepup in a headed browser, walks the journey's passes
(${PASSES.join(', ')}), records every spoken phrase to <out>/real-sr/*.txt|json and maps problems into
findings.json with method "real-screen-reader". Never activates, types or submits; non-GET requests are blocked.
Machine setup (once): npx @guidepup/setup setup && npx @guidepup/setup install   (see docs/real-screen-reader.md)

Options:
  --url <url>            page to visit (repeatable); overrides the journey's urls
  --journey <file>       journey JSON: {"name","urls":[...],"steps":["headings",{"pass":"links","max":80}],"max"}
  --sr <nvda|voiceover|auto>   default auto (NVDA on Windows, VoiceOver on macOS)
  --browser <name>       chromium (NVDA default) | webkit (VoiceOver default) | chrome | msedge | firefox
  --max <n>              cap steps per pass (default per pass, 20-60)
  -o, --out <dir>        output folder (default ./audit-output)
  --format <list>        report formats after the run (default json,md,html); --no-report to skip
  --dry-run              print the resolved plan as JSON and exit (works on any OS)
  -q, --quiet;  -h, --help
`;

const OPTS = {
  url: { type: 'string', multiple: true },
  journey: { type: 'string' },
  sr: { type: 'string' },
  browser: { type: 'string' },
  max: { type: 'string' },
  out: { type: 'string', short: 'o' },
  format: { type: 'string' },
  'no-report': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
};

/** @returns {Promise<number>} exit code (0 ok, 2 usage/environment, 3 a pass or page failed) */
export async function srMain(argv, { stdout, log, EXIT, run } = {}) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTS, allowPositionals: false, strict: true }));
  } catch (e) {
    log(`ada-audit sr: ${e.message}\nRun "ada-audit sr --help" for usage.`);
    return EXIT.USAGE;
  }
  if (values.help) {
    stdout(SR_HELP);
    return EXIT.OK;
  }
  const formats = String(values.format || 'json,md,html')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    for (const f of formats) if (!FORMATS[f]) throw new JourneyError(`unknown format "${f}"`);
    if (values.browser && !['chromium', 'chrome', 'msedge', 'firefox', 'webkit'].includes(values.browser))
      throw new JourneyError(`--browser must be chromium, chrome, msedge, firefox or webkit`);
    if (values.sr && !['nvda', 'voiceover', 'auto'].includes(values.sr)) throw new JourneyError('--sr must be nvda, voiceover or auto');
    const journey = loadJourney(values.journey, { urls: values.url || [], max: values.max !== undefined ? Number(values.max) : undefined });
    const out = values.out || './audit-output';
    if (values['dry-run']) {
      let sr = null;
      try {
        sr = resolveScreenReader(values.sr || 'auto');
      } catch (e) {
        sr = `unavailable here: ${e.message}`;
      }
      stdout(JSON.stringify({ screenReader: sr, browser: values.browser || null, out, journey }, null, 2) + '\n');
      return EXIT.OK;
    }
    resolveScreenReader(values.sr || 'auto');
    const { runRealScreenReader } = await import('../sr/driver.mjs');
    const r = await (run || runRealScreenReader)({
      journey,
      sr: values.sr || 'auto',
      browser: values.browser,
      out,
      log: values.quiet ? () => {} : log,
    });
    const failed = r.transcripts.filter((t) => t.error || (t.passes || []).some((p) => p.error));
    if (!values['no-report']) {
      const meta = fs.existsSync(path.join(out, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'run.json'), 'utf8')) : null;
      const { jobs, wallMs, concurrency, journeys, ...runMeta } = meta || {};
      const doc = buildDocument(out, {
        run: meta
          ? runMeta
          : {
              startedAt: r.transcripts[0]?.startedAt,
              finishedAt: r.transcripts.at(-1)?.finishedAt,
              pages: journey.urls,
              tools: ['real-sr'],
              readOnly: true,
            },
        journeys: journeys || [],
      });
      const written = writeReports(doc, out, { formats });
      if (!values.quiet)
        log(
          `${r.files.filter((f) => f.endsWith('.txt')).length} transcript(s); ${doc.findings.filter((f) => f.methods?.includes('real-screen-reader')).length} finding(s) with real screen-reader evidence; wrote\n${[...r.files.filter((f) => f.endsWith('.txt')), ...Object.values(written)].map((x) => '  ' + x).join('\n')}`,
        );
    }
    if (failed.length) {
      log(`ada-audit sr: ${failed.length} page(s) had a failed pass or run; see the transcript(s) and findings.json "errors".`);
      return EXIT.RUNTIME;
    }
    return EXIT.OK;
  } catch (e) {
    if (e instanceof JourneyError || e instanceof SrEnvironmentError) {
      log(`ada-audit sr: ${e.message}`);
      return EXIT.USAGE;
    }
    log(`ada-audit sr: ${e.stack || e.message}`);
    return EXIT.RUNTIME;
  }
}
