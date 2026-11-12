// System scanner: OS, CPU, RAM, GPUs (nvidia-smi + CIM), disks, permissions, relevant environment variables.
// Everything is read-only and asynchronous. The only network access is checkNetwork(), which the user triggers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT, PATHS } from '../workspace.js';

export function execText(cmd, args, { timeout = 15000, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 << 20, encoding: 'utf8', ...(env ? { env } : {}) }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err && err.code === 'ENOENT' ? 'not found' : err ? err.message.split('\n')[0] : null });
    });
  });
}

export function cmpVersion(a, b) {
  const pa = String(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0), pb = String(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return Math.sign(d); }
  return 0;
}

// One fixed PowerShell script (no user input) for the CIM queries Node cannot do itself.
const CIM_SCRIPT = `$ErrorActionPreference='SilentlyContinue';
$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1;
$gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name=$_.Name; driver=$_.DriverVersion; ramBytes=$_.AdapterRAM } });
$disks=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ id=$_.DeviceID; size=$_.Size; free=$_.FreeSpace; fs=$_.FileSystem } });
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
@{ caption=$os.Caption; version=$os.Version; build=$os.BuildNumber; osArch=$os.OSArchitecture; cpuName=$cpu.Name; cores=$cpu.NumberOfCores; threads=$cpu.NumberOfLogicalProcessors; gpus=$gpus; disks=$disks; elevated=$admin; ps=$PSVersionTable.PSVersion.ToString() } | ConvertTo-Json -Depth 4 -Compress`;

async function cim() {
  if (process.platform !== 'win32') return null;
  const r = await execText('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', CIM_SCRIPT], { timeout: 30000 });
  try { return JSON.parse(r.stdout.trim()); } catch { return null; }
}

export async function nvidia() {
  const r = await execText('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,driver_version,compute_cap,utilization.gpu', '--format=csv,noheader,nounits'], { timeout: 10000 });
  if (!r.ok) return { present: false, reason: r.error === 'not found' ? 'nvidia-smi not found (no NVIDIA driver)' : `nvidia-smi failed: ${r.error}` };
  const gpus = r.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [name, total, used, driver, cc, util] = l.split(',').map((x) => x.trim()); return { name, vramMB: +total, vramUsedMB: +used, driver, computeCapability: cc, utilization: +util }; });
  const g = gpus[0];
  const minDriver = '527.41';
  return { present: true, gpus, name: g.name, vramGB: +(g.vramMB / 1024).toFixed(1), driver: g.driver, computeCapability: g.computeCapability,
    cudaCapable: cmpVersion(g.driver, minDriver) >= 0 && parseFloat(g.computeCapability || '0') >= 5.0, minDriverForCuda126: minDriver };
}

const ENV_KEYS = ['PORT', 'STUDIO_URL', 'CHROME', 'SOFTWARE_GL', 'HF_HOME', 'HF_HUB_OFFLINE', 'CUDA_VISIBLE_DEVICES', 'PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'CONDA_PREFIX', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];
function envReport() {
  return ENV_KEYS.map((k) => {
    const v = process.env[k];
    const warn = (k === 'PYTHONHOME' || k === 'PYTHONPATH') && v ? 'Set globally: can break the studio\'s isolated Python environments' : null;
    // proxies may embed credentials: report only whether they are set
    return { name: k, set: v != null, value: v == null ? null : /PROXY/.test(k) ? '(set)' : v, warn };
  });
}

function writable(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); const t = path.join(dir, `.cf-write-${process.pid}`); fs.writeFileSync(t, ''); fs.rmSync(t); return true; } catch { return false; }
}

export async function scanSystem() {
  const t0 = Date.now();
  const [c, nv] = await Promise.all([cim(), nvidia()]);
  const release = os.release(), build = +(release.split('.')[2] || 0);
  const arch = process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || process.arch;
  let wsDisk = null; try { const s = fs.statfsSync(ROOT); wsDisk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }; } catch {}
  const folders = { workspace: ROOT, runtime: path.join(ROOT, 'runtime'), models: path.join(ROOT, 'models'), logs: PATHS.logs, projects: PATHS.projects, exports: PATHS.exports };
  return {
    scannedAt: new Date().toISOString(), scanMs: Date.now() - t0,
    os: { platform: process.platform, release, build: +(c?.build || build), name: c?.caption || `${os.type()} ${release}`, arch: String(arch).toLowerCase() === 'amd64' ? 'x64' : String(arch).toLowerCase(), osArch: c?.osArch || null, hostnameHidden: true },
    cpu: { model: (c?.cpuName || os.cpus()[0]?.model || '').trim(), cores: c?.cores || null, threads: c?.threads || os.cpus().length },
    ram: { totalGB: +(os.totalmem() / 1024 ** 3).toFixed(1), freeGB: +(os.freemem() / 1024 ** 3).toFixed(1) },
    gpu: { nvidia: nv, adapters: (c?.gpus || []).map((g) => ({ name: g.name, driver: g.driver })) },
    disks: (c?.disks || []).map((d) => ({ id: d.id, totalGB: +(d.size / 1024 ** 3).toFixed(1), freeGB: +(d.free / 1024 ** 3).toFixed(1), fs: d.fs })),
    workspaceDisk: wsDisk && { freeGB: +(wsDisk.freeBytes / 1024 ** 3).toFixed(1), totalGB: +(wsDisk.totalBytes / 1024 ** 3).toFixed(1), freeBytes: wsDisk.freeBytes },
    permissions: { elevated: c ? !!c.elevated : null, writable: Object.fromEntries(Object.entries(folders).map(([k, d]) => [k, writable(d)])) },
    env: envReport(),
    powershell: c?.ps || null,
  };
}

/** User-triggered reachability check of the download sources (HEAD, 5 s). No data is sent. */
export async function checkNetwork(hosts = ['huggingface.co', 'github.com', 'nodejs.org', 'www.gyan.dev', 'download.pytorch.org', 'pypi.org']) {
  const results = await Promise.all(hosts.map(async (h) => {
    const t = Date.now();
    try { const r = await fetch(`https://${h}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) }); return { host: h, reachable: true, status: r.status, ms: Date.now() - t }; }
    catch (e) { return { host: h, reachable: false, error: e.cause?.code || e.name, ms: Date.now() - t }; }
  }));
  return { checkedAt: new Date().toISOString(), online: results.some((r) => r.reachable), hosts: results };
}
