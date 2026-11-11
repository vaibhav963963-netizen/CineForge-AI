// Offline audit: while a production job runs, sample every TCP connection owned by a studio process (server, Python
// workers, FFmpeg, headless Chrome with the studio profile, llama-server, ComfyUI) and record any whose remote end is
// not loopback. Evidence that a full production run touches no external service.
//   node tools/offline-audit.mjs <jobId> [--url http://127.0.0.1:3200]   (stops when the job finishes)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS, ROOT } from '../dashboard/lib/workspace.js';

const jobId = process.argv[2], urlI = process.argv.indexOf('--url'), BASE = urlI > 0 ? process.argv[urlI + 1] : 'http://127.0.0.1:3200';
if (!jobId) { console.error('usage: node tools/offline-audit.mjs <jobId> [--url ...]'); process.exit(2); }
const ws = ROOT.replace(/'/g, "''");
const PS = `$p = @{}; Get-CimInstance Win32_Process | ForEach-Object { $p[[int]$_.ProcessId] = $_ };
$studio = $p.Values | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*${ws}*' -or $_.CommandLine -like '*studio-chrome-*' -or $_.CommandLine -like '*llama-server*') } | Select-Object -ExpandProperty ProcessId;
Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $studio -contains [int]$_.OwningProcess } | ForEach-Object { '{0}|{1}|{2}|{3}|{4}' -f $_.OwningProcess, $p[[int]$_.OwningProcess].Name, $_.RemoteAddress, $_.RemotePort, $_.State }`;
const LOOP = new Set(['127.0.0.1', '::1', '0.0.0.0', '::']);
const STOP = path.join(PATHS.logs, 'benchmarks', '.audit-stop');
fs.mkdirSync(path.dirname(STOP), { recursive: true }); fs.rmSync(STOP, { force: true });
const out = { kind: 'offline-audit', jobId, startedAt: new Date().toISOString(), samples: 0, studioConnections: 0, external: [], processesSeen: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (;;) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', PS], { encoding: 'utf8' });
  if (r.status !== 0) { out.error = r.stderr; break; }
  out.samples++;
  for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
    const [pid, name, addr, port, state] = line.split('|');
    out.studioConnections++; out.processesSeen[name] = (out.processesSeen[name] || 0) + 1;
    if (!LOOP.has(addr) && !out.external.some((e) => e.addr === addr && e.port === port && e.name === name)) out.external.push({ at: new Date().toISOString(), pid: +pid, name, addr, port, state });
  }
  if (jobId === 'all') {   // watch everything until the stop file appears (the acceptance script creates it)
    if (fs.existsSync(STOP)) { fs.rmSync(STOP, { force: true }); break; }
  } else {
    let st = null; try { st = await (await fetch(`${BASE}/api/jobs/${jobId}`)).json(); } catch {}
    if (st && ['completed', 'failed', 'cancelled'].includes(st.status)) { out.jobStatus = st.status; break; }
  }
  await sleep(1500);
}
out.finishedAt = new Date().toISOString(); out.passed = !out.error && out.external.length === 0 && out.samples > 3;
fs.mkdirSync(path.join(PATHS.logs, 'benchmarks'), { recursive: true });
const f = path.join(PATHS.logs, 'benchmarks', `offline-audit-${out.startedAt.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(f, JSON.stringify(out, null, 1));
console.log(`${out.passed ? 'PASS' : 'FAIL'}: ${out.samples} samples, ${out.studioConnections} studio connections, ${out.external.length} external`, out.external, '\nevidence:', path.relative(ROOT, f));
