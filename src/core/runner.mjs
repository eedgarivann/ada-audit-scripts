// Job runner: one shared Chromium per run (browser server), a concurrency-limited pool of tool processes,
// per-job timeouts, retries for crashes/flaky navigation, and per-job timing. Tools stay plain scripts.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

/** Start one browser server for the whole run; tools connect through ADA_BROWSER_WS (see core/lib.mjs safePage). */
export async function startBrowser({ channel } = {}) {
  const server = await chromium.launchServer({ headless: true, ...(channel ? { channel } : {}) });
  return { wsEndpoint: server.wsEndpoint(), close: () => server.close().catch(() => {}) };
}

/** Minimal p-limit: run async thunks with at most `n` in flight; results keep input order. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

export const defaultConcurrency = () => Math.max(1, Math.min(6, Math.floor((os.availableParallelism?.() || os.cpus().length) / 2) || 1));

/**
 * Run one job: `node <script> ...args`, with env, timeout and retries. Usage errors (exit 1 + "usage:") are not retried.
 * @param {{id:string, tool:string, script:string, args:string[], cwd?:string, logFile?:string}} job
 */
export function runJob(job, { env = {}, timeoutMs = 600000, retries = 1 } = {}) {
  const attempt = (n) =>
    new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(process.execPath, [job.script, ...job.args], {
        cwd: job.cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => {
        out += d;
      });
      child.stderr.on('data', (d) => {
        out += d;
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: timedOut ? 124 : (code ?? 1), ms: Date.now() - t0, out, timedOut, attempt: n });
      });
    });
  return (async () => {
    let r,
      n = 0;
    const tries = [];
    do {
      r = await attempt(++n);
      tries.push({ code: r.code, ms: r.ms, timedOut: r.timedOut });
    } while (r.code !== 0 && !/^usage:/m.test(r.out) && n <= retries);
    if (job.logFile) {
      fs.mkdirSync(path.dirname(job.logFile), { recursive: true });
      fs.writeFileSync(
        job.logFile,
        `$ node ${job.script} ${job.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n${r.out}\n# exit ${r.code} after ${n} attempt(s)\n`,
      );
    }
    return {
      id: job.id,
      tool: job.tool,
      code: r.code,
      ok: r.code === 0,
      ms: tries.reduce((a, t) => a + t.ms, 0),
      attempts: n,
      tries,
      timedOut: r.timedOut,
      tail: r.out.split('\n').slice(-6).join('\n'),
    };
  })();
}

/** Move a shard's output into the run directory; text summaries with the same name are concatenated (header kept once). */
export function mergeShard(shardDir, outDir) {
  if (!fs.existsSync(shardDir)) return;
  for (const ent of fs.readdirSync(shardDir, { withFileTypes: true })) {
    const src = path.join(shardDir, ent.name),
      dst = path.join(outDir, ent.name);
    if (ent.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      mergeShard(src, dst);
      continue;
    }
    if (!fs.existsSync(dst)) {
      fs.renameSync(src, dst);
      continue;
    }
    if (/\.(tsv|txt)$/.test(ent.name)) {
      const have = fs.readFileSync(dst, 'utf8');
      const add = fs
        .readFileSync(src, 'utf8')
        .split('\n')
        .filter((l) => l && !l.startsWith('#') && !/^url\t/.test(l));
      if (add.length) fs.appendFileSync(dst, (have.endsWith('\n') ? '' : '\n') + add.join('\n') + '\n');
    } else fs.renameSync(src, dst);
  }
  fs.rmSync(shardDir, { recursive: true, force: true });
}
