// Child processes for pipeline stages. Always asynchronous (never execSync: that froze the whole HTTP server, which
// is why the old progress bar jumped 5% → 70% → 100%). Each line of output is logged to the job; lines of the form
//   @@PROGRESS {"current":3,"total":8,"message":"..."}     → job.stageProgress(stage, …)
//   @@WARN some text                                       → job.warn(…)
//   @@RESULT {...}                                         → collected and returned to the caller
// are the progress protocol shared by voice.py, words.py, mix.py and capture.mjs.
import { spawn } from 'node:child_process';
import { childEnv } from './workspace.js';

export function run(job, stageId, cmd, args, { cwd, env, quiet = false, onLine } = {}) {
  return new Promise((resolve, reject) => {
    if (job) job.throwIfCancelled();
    const child = spawn(cmd, args, { cwd, env: env || childEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (job) job.children.add(child);
    const tail = [], results = [];
    const handle = (buf, isErr) => {
      for (const raw of buf.toString('utf8').split(/\r?\n|\r/)) {
        const line = raw.trimEnd(); if (!line) continue;
        if (line.startsWith('@@PROGRESS ')) {
          try { const p = JSON.parse(line.slice(11)); if (job) job.stageProgress(stageId, p); } catch {}
          continue;
        }
        if (line.startsWith('@@WARN ')) { if (job) job.warn(line.slice(7)); continue; }
        if (line.startsWith('@@RESULT ')) { try { results.push(JSON.parse(line.slice(9))); } catch {} continue; }
        tail.push(line); if (tail.length > 40) tail.shift();
        if (onLine) onLine(line, isErr);
        if (job && !quiet) job.log(`  ${isErr ? '!' : '·'} ${line.slice(0, 400)}`);
      }
    };
    child.stdout.on('data', (b) => handle(b, false));
    child.stderr.on('data', (b) => handle(b, true));
    child.on('error', (e) => { if (job) job.children.delete(child); reject(new Error(`${cmd} could not start: ${e.message}`)); });
    child.on('close', (code, signal) => {
      if (job) job.children.delete(child);
      if (job && job.cancelRequested) return reject(Object.assign(new Error('Job cancelled by user'), { cancelled: true }));
      if (code === 0) return resolve({ code, results, tail });
      const last = tail.slice(-8).join('\n');
      reject(new Error(`${shortName(cmd, args)} exited with ${signal || code}${last ? `:\n${last}` : ''}`));
    });
  });
}

const shortName = (cmd, args) => [cmd, ...args].map((a) => String(a).split(/[\\/]/).pop()).slice(0, 3).join(' ');
