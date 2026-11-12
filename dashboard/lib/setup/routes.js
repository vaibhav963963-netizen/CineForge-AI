// /api/setup/* — the restricted local installer API.
// Security model:
//   · loopback peers only (the server already binds 127.0.0.1; this re-checks the socket address)
//   · Host must be 127.0.0.1:<port> or localhost:<port> (blocks DNS-rebinding pages)
//   · Origin / Sec-Fetch-Site, when sent, must be this dashboard (blocks cross-site form posts)
//   · every non-GET request needs X-CineForge-Token, a random per-process token the dashboard page reads from
//     GET /api/setup/session (other origins cannot read it: no CORS headers are ever sent)
//   · requests name components by registry id only; URLs, commands and install paths come from the registry
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT } from '../workspace.js';
import { SetupService } from './index.js';
import { readLog, clearLog, logEvent, SETUP_DIR } from './log.js';
import { getSettings, updateSettings, updateStudioPath, validateDir, EDITABLE_PATHS } from './settings.js';
import { resolvedFiles, baseVars } from './registry.js';
import { hashFile } from './hashcache.js';
import { PATHS, STUDIO_CONFIG } from '../workspace.js';

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/, OPID = /^(op|dl|scan|health)-[0-9]{14}-[a-z0-9]{5}$/;
export class SetupHttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra; } }

export function createSetupRoutes({ port, isBusy = () => null, service } = {}) {
  const svc = service || new SetupService({ isBusy });
  const TOKEN = crypto.randomBytes(24).toString('hex');
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

  function gate(req) {
    const addr = req.socket.remoteAddress || '';
    if (!/^(127\.|::1$|::ffff:127\.)/.test(addr)) throw new SetupHttpError(403, 'setup API is only available from this computer');
    if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) throw new SetupHttpError(403, 'unexpected Host header');
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin.toLowerCase())) throw new SetupHttpError(403, 'cross-origin request refused');
    const sfs = req.headers['sec-fetch-site'];
    if (sfs && !['same-origin', 'none'].includes(sfs)) throw new SetupHttpError(403, 'cross-site request refused');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const t = String(req.headers['x-cineforge-token'] || '');
      if (t.length !== TOKEN.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN))) throw new SetupHttpError(401, 'missing or invalid setup token (reload the dashboard)');
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw new SetupHttpError(415, 'JSON body required');
    }
  }
  const ids = (list) => { if (!Array.isArray(list) || !list.length || list.length > 50) throw new SetupHttpError(400, 'ids must be a non-empty list'); for (const id of list) if (typeof id !== 'string' || !ID.test(id) || !svc.reg.byId.has(id)) throw new SetupHttpError(404, `unknown component ${String(id).slice(0, 60)}`); return list; };
  const wrap = (fn) => { try { return fn(); } catch (e) { throw new SetupHttpError(e.status || 400, e.message, e.plan ? { plan: e.plan } : undefined); } };
  const openFolder = (p) => { if (process.platform === 'win32') spawn('explorer.exe', fs.existsSync(p) && fs.statSync(p).isFile() ? ['/select,', p] : [p], { detached: true, stdio: 'ignore' }).unref(); };

  function presetIds(preset) {
    const comps = svc.components(), ok = (c) => ['ready', 'update-available'].includes(c.state.status);
    const auto = (c) => c.installType !== 'manual' && c.installType !== 'bootstrap' && c.installType !== 'none';
    const levels = { required: ['required'], recommended: ['required', 'recommended'], optional: ['required', 'recommended', 'optional'] }[preset];
    if (!levels) throw new SetupHttpError(400, 'preset must be required, recommended or optional');
    return comps.filter((c) => levels.includes(c.level) && !ok(c) && auto(c)).map((c) => c.id);
  }

  async function handle(req, res, url, { readBody, send }) {
    const p = url.pathname, m = (re) => p.match(re), method = req.method;
    gate(req);
    const body = method === 'POST' ? await readBody(req) : {};
    let r;
    if (p === '/api/setup/session') return send(res, 200, { token: TOKEN, port });
    if (p === '/api/setup/overview') return send(res, 200, svc.overview());
    if (p === '/api/setup/registry') return send(res, 200, { categories: svc.reg.categories, features: svc.reg.features, hardwareProfiles: svc.reg.hardwareProfiles, trustedHosts: svc.reg.trustedHosts });
    if (p === '/api/setup/scan' && method === 'POST') { const only = body.only ? ids(body.only) : undefined; const pr = svc.scan({ only }); if (body.wait) await pr; else pr.catch(() => {}); return send(res, 202, { scanning: svc.scanning, overview: body.wait ? svc.overview() : undefined }); }
    if (p === '/api/setup/components') return send(res, 200, svc.components());
    if ((r = m(/^\/api\/setup\/components\/([a-z0-9-]+)$/))) { ids([r[1]]); return send(res, 200, svc.components().find((c) => c.id === r[1])); }
    if ((r = m(/^\/api\/setup\/components\/([a-z0-9-]+)\/rescan$/)) && method === 'POST') { ids([r[1]]); await svc.rescanComponent(r[1]); return send(res, 200, svc.components().find((c) => c.id === r[1])); }
    if ((r = m(/^\/api\/setup\/components\/([a-z0-9-]+)\/import$/)) && method === 'POST') return send(res, 200, await importLocal(r[1], body));
    if (p === '/api/setup/hardware') return send(res, 200, svc.hardware());

    // operations
    if (p === '/api/setup/plan' && method === 'POST') { const list = body.preset ? presetIds(body.preset) : ids(body.ids); if (!list.length) return send(res, 200, { action: body.action, componentIds: [], manual: [], blockers: [], downloadBytes: 0, diskBytes: 0 }); return send(res, 200, wrap(() => ({ ...svc.im.plan(body.action, list, svc.statuses), freeBytes: svc.system?.workspaceDisk?.freeBytes ?? null }))); }
    if (p === '/api/setup/ops' && method === 'POST') {
      const list = body.preset ? presetIds(body.preset) : ids(body.ids);
      if (!list.length) throw new SetupHttpError(409, 'Nothing to install for that selection: everything already passes its checks.');
      const plan = wrap(() => svc.im.plan(body.action, list, svc.statuses));
      const free = svc.system?.workspaceDisk?.freeBytes;
      if (['install', 'repair', 'update'].includes(body.action) && free != null && plan.diskBytes > free) throw new SetupHttpError(507, `Insufficient storage: about ${(plan.diskBytes / 1073741824).toFixed(1)} GB needed, ${(free / 1073741824).toFixed(1)} GB free.`, { plan });
      if (['install', 'repair', 'update'].includes(body.action) && plan.downloadBytes > 0 && !getSettings().allowDownloads) throw new SetupHttpError(409, 'Downloads are disabled (offline mode in Advanced Settings). Import local files or enable downloads.');
      const out = wrap(() => svc.im.submit(body.action, list, svc.statuses, { confirmed: body.confirmed === true }));
      return send(res, 202, { ...out, plan });
    }
    if (p === '/api/setup/ops' && method === 'GET') return send(res, 200, svc.im.list(+(url.searchParams.get('limit') || 50)));
    if ((r = m(/^\/api\/setup\/ops\/([\w-]+)$/))) { if (!OPID.test(r[1])) throw new SetupHttpError(400, 'bad op id'); const o = svc.im.get(r[1]); if (!o) throw new SetupHttpError(404, 'operation not found'); return send(res, 200, o); }
    if ((r = m(/^\/api\/setup\/ops\/([\w-]+)\/cancel$/)) && method === 'POST') { if (!OPID.test(r[1])) throw new SetupHttpError(400, 'bad op id'); return send(res, 200, svc.im.cancel(r[1]) || {}); }
    if ((r = m(/^\/api\/setup\/ops\/([\w-]+)\/retry$/)) && method === 'POST') {
      if (!OPID.test(r[1])) throw new SetupHttpError(400, 'bad op id'); const o = svc.im.get(r[1]); if (!o) throw new SetupHttpError(404, 'operation not found');
      if (!['failed', 'cancelled', 'interrupted'].includes(o.status)) throw new SetupHttpError(409, 'only failed, cancelled or interrupted operations can be retried');
      const action = o.action === 'install' ? 'install' : o.action;
      return send(res, 202, wrap(() => svc.im.submit(action, o.requested, svc.statuses, { confirmed: true })));
    }

    // downloads
    if (p === '/api/setup/downloads') return send(res, 200, svc.dm.list());
    if ((r = m(/^\/api\/setup\/downloads\/([\w-]+)\/(pause|resume|cancel|retry|remove|open|verify)$/)) && method === 'POST') {
      if (!OPID.test(r[1])) throw new SetupHttpError(400, 'bad download id'); const d = svc.dm.get(r[1]); if (!d) throw new SetupHttpError(404, 'download not found');
      if (r[2] === 'open') { openFolder(fs.existsSync(d.dest) ? d.dest : path.dirname(d.dest)); return send(res, 200, { opened: true }); }
      if (r[2] === 'verify') {
        if (d.status !== 'completed' || !fs.existsSync(d.dest)) throw new SetupHttpError(409, 'only a completed download that is still on disk can be verified');
        if (!d.sha256 && !d.sha512b64) return send(res, 200, { verified: fs.statSync(d.dest).size === (d.size || d.total), method: 'size' });
        const got = await hashFile(d.dest, { algo: d.sha256 ? 'sha256' : 'sha512', encoding: d.sha256 ? 'hex' : 'base64', useCache: false });
        return send(res, 200, { verified: got === (d.sha256 || d.sha512b64), method: d.sha256 ? 'sha256' : 'sha512' });
      }
      return send(res, 200, wrap(() => svc.dm[r[2]](r[1])));
    }

    // logs & diagnostics
    if (p === '/api/setup/logs') { const opId = url.searchParams.get('opId'), comp = url.searchParams.get('componentId'); return send(res, 200, readLog({ limit: Math.min(2000, +(url.searchParams.get('limit') || 300)), opId: opId && OPID.test(opId) ? opId : undefined, componentId: comp && ID.test(comp) ? comp : undefined })); }
    if (p === '/api/setup/logs/clear' && method === 'POST') { if (body.confirm !== true) throw new SetupHttpError(428, 'confirm required'); clearLog(); logEvent({ kind: 'logs', action: 'cleared' }); return send(res, 200, { cleared: true }); }
    if (p === '/api/setup/logs/open' && method === 'POST') { openFolder(SETUP_DIR); return send(res, 200, { opened: true, path: path.relative(ROOT, SETUP_DIR) }); }
    if (p === '/api/setup/diagnostics') {
      const d = svc.diagnostics();
      if (url.searchParams.get('download') === '1') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="cineforge-setup-report-${d.generatedAt.slice(0, 10)}.json"`, 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(d, null, 2)); }
      return send(res, 200, d);
    }

    // health & network
    if (p === '/api/setup/health' && method === 'GET') return send(res, 200, svc.health);
    if (p === '/api/setup/health' && method === 'POST') { const which = Array.isArray(body.which) ? body.which.filter((x) => /^[a-z]+$/.test(x)) : undefined; return send(res, 200, await svc.runHealth({ which, loadTest: body.loadTest === true, port })); }
    if (p === '/api/setup/network' && method === 'POST') return send(res, 200, await svc.checkNetwork());

    // storage
    if (p === '/api/setup/storage') return send(res, 200, await svc.storage());
    if (p === '/api/setup/storage/cleanup' && method === 'POST') { if (body.confirm !== true) throw new SetupHttpError(428, 'confirm required'); if (!['partial-downloads', 'download-temp', 'image-cache', 'setup-logs'].includes(body.id)) throw new SetupHttpError(404, 'unknown cleanup'); return send(res, 200, svc.cleanup(body.id)); }

    // configuration
    if (p === '/api/setup/config' && method === 'GET') {
      const v = baseVars();
      const paths = Object.keys(EDITABLE_PATHS).map((k) => { const abs = k.startsWith('models.') ? PATHS.models[k.slice(7)] : PATHS[k]; return { key: k, path: abs, exists: fs.existsSync(abs) }; });
      const runtime = [['Studio Python', PATHS.python], ['FFmpeg folder', PATHS.ffmpegBin], ['llama.cpp folder', PATHS.llamaCpp], ['ComfyUI folder', PATHS.comfyui], ['Download folder', v.tmp]].map(([name, pth]) => ({ name, path: pth, exists: fs.existsSync(pth) }));
      return send(res, 200, { settings: getSettings(), paths, runtime, services: STUDIO_CONFIG.services, port, browser: svc.statuses.browser?.location || null });
    }
    if (p === '/api/setup/config' && method === 'POST') { const allowed = ['hardwareProfile', 'downloadConcurrency', 'downloadSegments', 'downloadDir', 'allowDownloads']; const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k))); const out = updateSettings(patch); if (!out.ok) throw new SetupHttpError(422, out.errors.join('; ')); return send(res, 200, out); }
    if (p === '/api/setup/config/validate-path' && method === 'POST') return send(res, 200, validateDir(body.value));
    if (p === '/api/setup/config/path' && method === 'POST') { if (body.confirm !== true) throw new SetupHttpError(428, 'confirm required'); const out = updateStudioPath(String(body.key || ''), body.value); if (!out.ok) throw new SetupHttpError(422, out.errors.join('; ')); return send(res, 200, out); }
    if (p === '/api/setup/wizard' && method === 'POST') { const out = svc.wizardUpdate({ step: body.step, dismissed: body.dismissed }); if (!out.ok) throw new SetupHttpError(422, out.errors.join('; ')); return send(res, 200, out.settings.wizard); }

    // live events
    if (p === '/api/setup/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const push = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      const last = new Map(); const throttled = (ev) => (d) => { const k = ev + (d?.id || ''); const now = Date.now(); if (now - (last.get(k) || 0) < 300 && !['completed', 'failed', 'cancelled', 'paused'].includes(d?.status)) return; last.set(k, now); push(ev, d); };
      const h = { op: throttled('op'), download: throttled('download'), status: (d) => push('status', d), scan: (d) => push('scan', d) };
      for (const [ev, fn] of Object.entries(h)) svc.on(ev, fn);
      const hb = setInterval(() => res.write(`: hb\n\n`), 15000);
      req.on('close', () => { clearInterval(hb); for (const [ev, fn] of Object.entries(h)) svc.off(ev, fn); });
      return;
    }
    throw new SetupHttpError(404, `unknown setup endpoint ${method} ${p}`);
  }

  /** Offline install: copy a file the user already has, only if it matches the registry's checksum. */
  async function importLocal(componentId, body) {
    ids([componentId]); const c = svc.reg.byId.get(componentId);
    if (c.detect.type !== 'files') throw new SetupHttpError(400, 'only model / asset files can be imported');
    const f = resolvedFiles(c).find((x) => x.path === body.file); if (!f) throw new SetupHttpError(404, 'that file is not part of the component');
    if (!f.sha256) throw new SetupHttpError(422, 'this file has no checksum on record, so an imported copy cannot be verified');
    const src = path.resolve(String(body.source || '')); let st;
    try { st = fs.statSync(src); } catch { throw new SetupHttpError(404, 'source file not found'); }
    if (!st.isFile()) throw new SetupHttpError(400, 'source is not a file');
    if (f.size && st.size !== f.size) throw new SetupHttpError(422, `size ${st.size} ≠ expected ${f.size}`);
    const got = await hashFile(src, { useCache: false });
    if (got !== f.sha256) { logEvent({ kind: 'import', componentId, result: 'mismatch' }); throw new SetupHttpError(422, 'SHA-256 does not match the published value: not imported'); }
    fs.mkdirSync(path.dirname(f.abs), { recursive: true });
    fs.copyFileSync(src, `${f.abs}.import`); fs.renameSync(`${f.abs}.import`, f.abs);
    logEvent({ kind: 'import', componentId, file: f.path, result: 'imported' });
    return { imported: true, component: await svc.rescanComponent(componentId) };
  }

  return { handle, service: svc, token: TOKEN };
}
