// Settings → System Setup. One status, one next step, details on demand.
// Every value comes from /api/setup/* (real detection; live download/install state over SSE, with polling fallback).
// Progress bars appear only when the backend reports bytes; steps without a measurable total show the latest real line.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const B = (n) => (n == null || isNaN(n) ? '' : n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${Math.round(n / 1048576)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
  const T = (s) => (s == null ? '' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
  const ago = (iso) => { if (!iso) return 'never'; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString(); };
  const OK = (st) => st === 'ready' || st === 'update-available';
  const BUSY = ['downloading', 'installing', 'verifying', 'configuring', 'queued', 'paused'];
  const LABEL = { ready: 'Installed', 'update-available': 'Update available', 'not-installed': 'Not installed', 'not-checked': 'Not checked', failed: 'Needs repair', incompatible: 'Wrong version', 'insufficient-storage': 'Not enough space', downloading: 'Downloading', installing: 'Installing', verifying: 'Verifying', configuring: 'Configuring', queued: 'Queued', paused: 'Paused', cancelled: 'Cancelled', interrupted: 'Interrupted', healthy: 'Healthy', warning: 'Warning', 'not-configured': 'Not set up', running: 'Running', completed: 'Done' };
  const TONE = { ready: 'ok', healthy: 'ok', completed: 'ok', 'update-available': 'warn', warning: 'warn', 'not-installed': 'warn', paused: 'warn', 'not-configured': 'warn', failed: 'bad', incompatible: 'bad', 'insufficient-storage': 'bad', cancelled: 'bad', interrupted: 'bad', downloading: 'busy', installing: 'busy', verifying: 'busy', configuring: 'busy', queued: 'busy', running: 'busy' };
  const pill = (s) => `<span class="su-pill ${TONE[s] || ''}">${esc(LABEL[s] || s)}</span>`;
  const toast = (m) => { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = m; el.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => (el.className = ''), 4500); };

  const S = { token: null, ov: null, comps: [], dls: [], ops: [], health: null, hw: null, storage: null, config: null, tab: 'overview', filter: null, open: new Set(), menu: null, logOp: null, es: null, started: false };

  async function api(path, { method = 'GET', body } = {}) {
    if (!S.token && method !== 'GET') await session();
    const r = await fetch(path, { method, headers: method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CineForge-Token': S.token } : {}, body: method !== 'GET' ? JSON.stringify(body || {}) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) S.token = null;
    if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; e.data = j; throw e; }
    return j;
  }
  async function session() { S.token = (await api('/api/setup/session')).token; }

  async function refresh(parts = ['ov', 'comps', 'dls', 'ops']) {
    const src = { ov: '/api/setup/overview', comps: '/api/setup/components', dls: '/api/setup/downloads', ops: '/api/setup/ops?limit=30', hw: '/api/setup/hardware', config: '/api/setup/config', storage: '/api/setup/storage', health: '/api/setup/health' };
    const res = await Promise.allSettled(parts.map((p) => api(src[p])));
    res.forEach((r, i) => { if (r.status === 'fulfilled') S[parts[i]] = r.value; });
    render();
  }
  const soon = (() => { let t; return (parts) => { clearTimeout(t); t = setTimeout(() => refresh(parts), 400); }; })();

  function connect() {
    if (S.es) return;
    S.es = new EventSource('/api/setup/events');
    S.es.addEventListener('download', (e) => { const d = JSON.parse(e.data); const i = S.dls.findIndex((x) => x.id === d.id); if (d.removed) { if (i >= 0) S.dls.splice(i, 1); } else if (i >= 0) S.dls[i] = d; else S.dls.unshift(d); renderLive(); if (S.tab === 'components') renderComponents(); if (S.tab === 'activity') renderActivity(); if (['completed', 'failed', 'cancelled'].includes(d.status)) soon(['ov', 'comps']); });
    S.es.addEventListener('op', (e) => { const o = JSON.parse(e.data); const i = S.ops.findIndex((x) => x.id === o.id); if (i >= 0) S.ops[i] = o; else S.ops.unshift(o); renderLive(); if (S.tab === 'activity') renderActivity(); if (['completed', 'failed', 'cancelled'].includes(o.status)) { soon(['ov', 'comps', 'dls']); toast(o.status === 'completed' ? `✓ ${cap(o.action)} finished` : `✖ ${cap(o.action)} ${o.status}${o.error ? ': ' + o.error : ''}`); } });
    S.es.addEventListener('status', () => soon(['ov', 'comps']));
    S.es.addEventListener('scan', (e) => { const s = JSON.parse(e.data); if (!s) refresh(['ov', 'comps', 'hw']); else if (S.ov) { S.ov.scanning = s; renderOverview(); } });
    S.es.onerror = () => { S.es.close(); S.es = null; setTimeout(connect, 3000); };
    setInterval(() => { if (!S.es || S.es.readyState !== 1) refresh(); }, 5000);
  }
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const name = (id) => S.comps.find((c) => c.id === id)?.name || id;
  const auto = (c) => !['manual', 'bootstrap', 'none'].includes(c.installType);

  // ── actions ──────────────────────────────────────────────────────────────────────────────────────────────
  async function runOp(action, ids, preset) {
    try {
      const plan = await api('/api/setup/plan', { method: 'POST', body: { action, ids, preset } });
      if (!plan.componentIds.length) { if (plan.manual.length) alert(plan.manual.map((m) => `${m.name}: ${m.instructions}`).join('\n\n')); else toast('Nothing to do — everything selected already works.'); return; }
      const lines = [`${cap(action)}: ${plan.componentIds.map(name).join(', ')}`];
      if (plan.downloadBytes) lines.push(`Download: ${B(plan.downloadBytes)} from the official sources (checksums verified).`);
      if (plan.diskBytes && plan.freeBytes != null) lines.push(`Disk space: about ${B(plan.diskBytes)} (${B(plan.freeBytes)} free).`);
      if (action === 'remove') lines.push('The model files will be deleted. Features that need them stop working until you install them again.');
      if (action === 'repair') lines.push('Repair downloads or rebuilds it again, even if it looks installed.');
      if (plan.manual.length) lines.push(`Install yourself (system programs): ${plan.manual.map((m) => m.name).join(', ')}.`);
      if (!confirm(lines.join('\n\n'))) return;
      const r = await api('/api/setup/ops', { method: 'POST', body: { action, ids, preset, confirmed: true } });
      S.ops.unshift(r.op); renderLive(); soon(['ov', 'comps']);
    } catch (e) { toast(`✖ ${e.message}`); }
  }
  const scan = async () => { try { await api('/api/setup/scan', { method: 'POST' }); refresh(['ov']); } catch (e) { toast(e.message); } };

  // ── what the user should do next ────────────────────────────────────────────────────────────────────────
  function nextStep() {
    const ov = S.ov; if (!ov) return null;
    if (ov.scanning) return { title: 'Checking this PC…', text: 'Looking at Python, FFmpeg, models and your hardware. This takes about a minute.', busy: true };
    if (!ov.lastScanAt) return { title: 'Not checked yet', text: 'Scan this PC to see what CineForge needs.', btn: ['scan', 'Scan this PC'] };
    const op = S.ops.find((o) => ['running', 'queued'].includes(o.status));
    if (op) return { title: `${cap(op.action)} in progress`, text: `${name(op.current || op.componentIds[0])} · ${op.componentIds.length > 1 ? `${op.componentIds.indexOf(op.current) + 1} of ${op.componentIds.length}` : ''}`, busy: true };
    const missReq = S.comps.filter((c) => c.level === 'required' && !OK(c.state.status));
    if (missReq.length) {
      const fixable = missReq.filter(auto), size = fixable.reduce((a, c) => a + (c.downloadBytes || 0), 0);
      return { title: 'Setup needed', tone: 'warn', text: `${missReq.length} required component${missReq.length > 1 ? 's are' : ' is'} missing: ${missReq.map((c) => c.name).join(', ')}.`, btn: fixable.length ? ['preset-required', `Install required${size ? ` · ${B(size)}` : ''}`] : null };
    }
    const missRec = S.comps.filter((c) => c.level === 'recommended' && !OK(c.state.status) && auto(c));
    if (missRec.length) return { title: 'Ready — some features are off', tone: 'ok', text: `Add ${missRec.map((c) => c.name).join(', ')} to turn on ${[...new Set(missRec.flatMap((c) => (c.features || []).map((f) => S.ov.features.find((x) => x.id === f)?.name).filter(Boolean)))].join(', ') || 'more features'}.`, btn: ['preset-recommended', `Install recommended · ${B(missRec.reduce((a, c) => a + (c.downloadBytes || 0), 0))}`] };
    const broken = S.comps.filter((c) => ['failed', 'incompatible'].includes(c.state.status));
    if (broken.length) return { title: 'Something needs repair', tone: 'warn', text: broken.map((c) => c.name).join(', '), btn: ['repair-broken', 'Repair'] };
    return { title: 'Ready to create', tone: 'ok', text: `Everything CineForge needs is installed and verified · checked ${ago(ov.lastScanAt)}.`, btn: null };
  }

  // ── render ───────────────────────────────────────────────────────────────────────────────────────────────
  function render() { if (!S.started) return; renderTabs(); renderBanner(); renderLive(); ({ overview: renderOverview, components: renderComponents, activity: renderActivity, health: renderHealth, settings: renderSettings })[S.tab]?.(); }

  function renderTabs() {
    const attention = S.comps.filter((c) => !OK(c.state.status) && c.state.status !== 'not-checked' && c.level !== 'optional').length;
    const active = S.dls.filter((d) => ['downloading', 'queued', 'paused'].includes(d.status)).length + S.ops.filter((o) => ['running', 'queued'].includes(o.status)).length;
    const tabs = [['overview', 'Overview'], ['components', 'Components', attention], ['activity', 'Activity', active], ['health', 'Health'], ['settings', 'Settings']];
    $('#su-tabs').innerHTML = tabs.map(([id, l, n]) => `<button class="su-tab ${S.tab === id ? 'active' : ''}" data-sutab="${id}">${l}${n ? ` <span class="su-count">${n}</span>` : ''}</button>`).join('');
    $$('.su-pane').forEach((p) => p.classList.toggle('active', p.id === `su-${S.tab}`));
  }

  function renderBanner() {   // on the Dashboard screen, only when setup is actually needed
    const el = $('#su-global-banner'); if (!el || !S.ov) return;
    const n = nextStep(); el.hidden = !n || !['Setup needed', 'Not checked yet'].includes(n.title);
    if (!el.hidden) el.innerHTML = `<span>${esc(n.title)}: ${esc(n.text)}</span><button class="btn btn-primary btn-sm" data-goto="setup">Open System Setup</button>`;
  }

  /** the one strip that shows work in progress, on every tab */
  function renderLive() {
    const el = $('#su-activeop'); if (!el) return;
    const op = S.ops.find((o) => ['running', 'queued'].includes(o.status));
    const dl = S.dls.find((d) => d.status === 'downloading') || S.dls.find((d) => d.status === 'paused');
    if (!op && !dl) { el.hidden = true; return; }
    el.hidden = false;
    const p = op?.progress, bytes = dl && dl.total ? dl : p && p.unit === 'byte' && p.total ? { bytes: p.current, total: p.total } : null;
    const pct = bytes ? Math.min(100, Math.round((100 * bytes.bytes) / bytes.total)) : null;
    const what = op ? `${cap(op.action)} · ${esc(name(op.current || op.componentIds[0]))}` : `Download · ${esc(dl.label)}`;
    const detail = dl && dl.status === 'downloading' ? `${B(dl.bytes)} of ${B(dl.total)}${dl.speed ? ` · ${B(dl.speed)}/s` : ''}${dl.eta ? ` · ${T(dl.eta)} left` : ''}` : dl?.status === 'paused' ? `Paused at ${B(dl.bytes)} of ${B(dl.total)}` : esc(p?.message || op?.stage || '');
    el.innerHTML = `<div class="su-row between"><div><b>${what}</b><div class="muted su-small">${detail}</div></div><div class="su-row">${dl && dl.status === 'downloading' ? `<button class="btn btn-secondary btn-sm" data-dl="pause" data-id="${dl.id}">Pause</button>` : ''}${dl && dl.status === 'paused' ? `<button class="btn btn-primary btn-sm" data-dl="resume" data-id="${dl.id}">Resume</button>` : ''}${op ? `<button class="btn btn-secondary btn-sm" data-opcancel="${op.id}">Cancel</button>` : dl ? `<button class="btn btn-secondary btn-sm" data-dl="cancel" data-id="${dl.id}">Cancel</button>` : ''}</div></div>
      <div class="su-bar ${pct == null ? 'indet' : ''}"><i style="width:${pct ?? 30}%"></i></div>`;
  }

  function renderOverview() {
    const el = $('#su-overview-body'), ov = S.ov; if (!el || !ov) return;
    const n = nextStep(), sys = ov.system;
    const steps = [
      ['Scan this PC', !!ov.lastScanAt],
      ['Install required components', ov.readyToLaunch],
      ['Add recommended features (optional)', !S.comps.some((c) => c.level === 'recommended' && !OK(c.state.status))],
      ['Run a health check', !!S.health && Object.values(S.health.checks || {}).every((c) => c.status !== 'failed')],
    ];
    const needs = S.comps.filter((c) => !OK(c.state.status) && c.state.status !== 'not-checked' && c.level !== 'optional');
    const nv = sys?.gpu?.nvidia;
    el.innerHTML = `
      <div class="su-hero ${n?.tone || ''}">
        <div><h2>${esc(n?.title || '')}</h2><p>${esc(n?.text || '')}</p></div>
        <div class="su-row">${n?.btn ? `<button class="btn btn-primary" data-su="${n.btn[0]}">${esc(n.btn[1])}</button>` : ''}${!n?.busy && ov.lastScanAt ? `<button class="btn btn-secondary btn-sm" data-su="scan">Scan again</button>` : ''}</div>
      </div>
      ${!ov.readyToLaunch || !steps[3][1] ? `<ol class="su-check">${steps.map(([t, done]) => `<li class="${done ? 'done' : ''}">${esc(t)}</li>`).join('')}</ol>` : ''}
      ${needs.length ? `<h4 class="su-h">Needs attention</h4><div class="su-list">${needs.map(row).join('')}</div>` : ''}
      <h4 class="su-h">Features</h4>
      <div class="su-features">${ov.features.map((f) => `<div class="su-feat ${f.ready ? 'on' : 'off'}" title="${esc(f.ready ? 'Ready' : 'Needs: ' + f.missing.map((m) => m.name).join(', '))}"><span>${f.ready ? '✓' : '—'}</span>${esc(f.name)}</div>`).join('')}</div>
      ${sys ? `<p class="su-sys">${esc(sys.os.name.replace('Microsoft ', ''))} · ${esc(sys.cpu.model.replace(/\(R\)|\(TM\)|CPU|Processor|\d+th Gen /g, '').replace(/\s+/g, ' ').trim())} · ${Math.round(sys.ram.totalGB)} GB RAM · ${nv?.present ? `${esc(nv.name.replace(/NVIDIA GeForce |Laptop GPU/g, '').trim())} ${nv.vramGB} GB` : 'no NVIDIA GPU'} · ${sys.workspaceDisk ? `${sys.workspaceDisk.freeGB} GB free` : ''}</p>` : ''}`;
  }

  // always-present plumbing: shown only when something is wrong with it
  const SYSTEM = new Set(['os', 'powershell', 'tar', 'npm-packages', 'studio-files', 'node']);
  /** what the row says under the name: what it is for, in plain words */
  const purpose = (c) => { const f = (c.features || []).map((id) => S.ov?.features.find((x) => x.id === id)?.name).filter(Boolean); return f.length ? `For ${f.slice(0, 3).join(' · ')}` : String(c.description || '').split(/(?<=\.)\s/)[0].replace(/^[\w./\\-]+:\s*/, '').replace(/^./, (m) => m.toUpperCase()); };
  // only real version numbers ("3.12.10", "9.0.2-full…"), never counts like "15/15 pinned packages"
  const shortVersion = (v) => { const s = String(v || ''); if (s.includes('/') || !/^\d/.test(s)) return ''; const m = s.match(/^\d+(?:\.\d+){0,2}/); return m ? `v${m[0]}` : ''; };
  const PROFILE_TEXT = { auto: ['Automatic', 'Picks the best option for this PC.'], 'nvidia-cuda': ['NVIDIA graphics card', 'Fastest. Scripts and AI images run on your NVIDIA GPU.'], cpu: ['Processor only', 'Works on any PC. AI images become very slow (minutes each).'], 'low-memory': ['Low memory', 'For PCs with under 12 GB RAM or a 4 GB graphics card.'] };

  /** one component row: status dot, one contextual action, details on click */
  function row(c, { showLevel = true } = {}) {
    const st = c.state, live = st.live || st.status, open = S.open.has(c.id);
    const dl = S.dls.find((d) => d.componentId === c.id && ['downloading', 'queued', 'paused', 'verifying'].includes(d.status));
    let action = '';
    if (BUSY.includes(live)) action = dl && dl.total ? `<span class="su-mini"><i style="width:${dl.percent || 0}%"></i></span><span class="muted su-small">${dl.percent || 0}%</span>` : `<span class="muted su-small">${esc(LABEL[live] || live)}…</span>`;
    else if (!auto(c) && !OK(st.status)) action = `<button class="btn btn-secondary btn-sm" data-toggle="${c.id}">How to install</button>`;
    else if (['not-installed', 'insufficient-storage', 'cancelled', 'interrupted'].includes(live) || (live === 'failed' && st.status === 'not-installed')) action = `<button class="btn btn-primary btn-sm" data-op="install" data-id="${c.id}">${live === 'cancelled' || live === 'interrupted' || live === 'failed' ? 'Retry' : 'Install'}${c.downloadBytes ? ` · ${B(c.downloadBytes)}` : ''}</button>`;
    else if (['failed', 'incompatible'].includes(st.status)) action = `<button class="btn btn-primary btn-sm" data-op="repair" data-id="${c.id}">Repair</button>`;
    else if (st.status === 'update-available') action = `<button class="btn btn-secondary btn-sm" data-op="update" data-id="${c.id}">Update</button>`;
    const menu = OK(st.status) && !BUSY.includes(live) && auto(c) ? `<button class="su-more" data-menu="${c.id}" title="More">⋯</button>${S.menu === c.id ? `<div class="su-menu"><button data-op="verify" data-id="${c.id}">Verify files</button><button data-op="repair" data-id="${c.id}">Reinstall</button>${c.category === 'models' ? `<button data-op="remove" data-id="${c.id}" class="danger">Remove</button>` : ''}</div>` : ''}` : '';
    const facts = [
      c.description && ['About', c.description],
      st.version && ['Version', st.version], (st.location || c.location) && ['Location', st.location || c.location],
      st.integrity && ['Files', { verified: 'checksum verified', unverified: 'size matches (checksum not checked yet)', corrupted: 'corrupted', 'size-checked': 'size matches' }[st.integrity] || st.integrity],
      c.features?.length && ['Used for', c.features.map((f) => S.ov?.features.find((x) => x.id === f)?.name || f).join(', ')],
      c.license && ['License', c.license], c.homepage && ['Source', `<a href="${esc(c.homepage)}" target="_blank" rel="noopener noreferrer">${esc(c.homepage.replace(/^https:\/\/(www\.)?/, ''))}</a>`],
    ].filter(Boolean);
    return `<div class="su-item ${open ? 'open' : ''}">
      <div class="su-item-main" data-toggle="${c.id}">
        <span class="su-dot ${TONE[live] || ''}"></span>
        <div class="su-item-text"><b>${esc(c.name)}</b><span>${esc(purpose(c))}</span></div>
        ${showLevel && c.level !== 'required' ? `<span class="su-tag">${c.level}</span>` : ''}
        <div class="su-item-act" data-stop>${st.status === 'ready' && !BUSY.includes(live) ? `<span class="muted su-small">${esc(shortVersion(st.version))}</span>` : st.status === 'update-available' ? pill(st.status) : ''}${action}${menu}</div>
      </div>
      ${open ? `<div class="su-item-detail">
        ${st.problems?.length ? `<p class="su-problem">${st.problems.map(esc).join('<br>')}</p>` : ''}
        ${!auto(c) && c.instructions ? `<p>${esc(c.instructions)}</p>` : ''}
        <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${k === 'Source' ? v : esc(v)}</dd>`).join('')}</dl>
      </div>` : ''}
    </div>`;
  }

  function renderComponents() {
    const el = $('#su-components-body'); if (!el || !S.comps.length) return;
    const attention = S.comps.filter((c) => !OK(c.state.status) && c.state.status !== 'not-checked');
    const f = S.filter ?? (attention.length ? 'attention' : 'all');
    const list = f === 'attention' ? attention : S.comps;
    const groups = [['required', 'Required'], ['recommended', 'Recommended'], ['optional', 'Optional']];
    el.innerHTML = `<div class="su-row between su-gap"><div class="su-seg">${attention.length ? `<button class="${f === 'attention' ? 'on' : ''}" data-filter="attention">Needs attention (${attention.length})</button>` : ''}<button class="${f === 'all' ? 'on' : ''}" data-filter="all">All (${S.comps.length})</button></div>
      <button class="btn btn-secondary btn-sm" data-su="verify-all">Verify all</button></div>
      ${groups.map(([lvl, title]) => { const cs = list.filter((c) => c.level === lvl && !(SYSTEM.has(c.id) && OK(c.state.status))); return cs.length ? `<h4 class="su-h">${title}</h4><div class="su-list">${cs.map((c) => row(c, { showLevel: false })).join('')}</div>` : ''; }).join('') || '<p class="muted">Nothing needs attention.</p>'}
      ${f === 'all' ? (() => { const sys = S.comps.filter((c) => SYSTEM.has(c.id) && OK(c.state.status)); return sys.length ? `<details class="su-details"><summary>System (${sys.length}) · all working</summary><div class="su-list">${sys.map((c) => row(c, { showLevel: false })).join('')}</div></details>` : ''; })() : ''}`;
  }

  async function renderActivity() {
    const el = $('#su-activity-body'); if (!el) return;
    const dls = S.dls.filter((d) => d.status !== 'completed').concat(S.dls.filter((d) => d.status === 'completed').slice(0, 5));
    const sel = S.logOp && S.ops.find((o) => o.id === S.logOp);
    let full = null; if (sel) { try { full = await api(`/api/setup/ops/${sel.id}`); } catch {} }
    const dlAct = (d) => ({ downloading: [['pause', 'Pause'], ['cancel', 'Cancel']], queued: [['cancel', 'Cancel']], paused: [['resume', 'Resume', 1], ['cancel', 'Cancel']], failed: [['retry', 'Retry', 1], ['remove', 'Remove']], cancelled: [['retry', 'Retry'], ['remove', 'Remove']] }[d.status] || []).map(([a, l, p]) => `<button class="btn ${p ? 'btn-primary' : 'btn-secondary'} btn-sm" data-dl="${a}" data-id="${d.id}">${l}</button>`).join('');
    el.innerHTML = `
      ${dls.length ? `<h4 class="su-h">Downloads</h4><div class="su-list">${dls.map((d) => `<div class="su-item"><div class="su-item-main">
        <span class="su-dot ${TONE[d.status] || ''}"></span>
        <div class="su-item-text"><b>${esc(d.label)}</b><span>${d.status === 'completed' ? `${B(d.total)} · ${d.verified === 'size' ? 'size checked' : 'checksum verified'} · ${ago(d.completedAt)}` : d.error ? esc(d.error) : `${B(d.bytes)} of ${B(d.total)}${d.status === 'downloading' && d.speed ? ` · ${B(d.speed)}/s · ${T(d.eta)} left` : ''}${d.note ? ` · ${esc(d.note)}` : ''}`}</span>
        ${['downloading', 'paused', 'queued'].includes(d.status) && d.total ? `<div class="su-bar"><i style="width:${d.percent || 0}%"></i></div>` : ''}</div>
        <div class="su-item-act">${d.status === 'completed' ? '' : pill(d.status)}${dlAct(d)}</div></div></div>`).join('')}</div>` : ''}
      <h4 class="su-h">History</h4>
      ${S.ops.length ? `<div class="su-list">${S.ops.slice(0, 15).map((o) => `<div class="su-item ${S.logOp === o.id ? 'open' : ''}"><div class="su-item-main" data-oplog="${o.id}">
        <span class="su-dot ${TONE[o.status] || ''}"></span>
        <div class="su-item-text"><b>${cap(o.action)} · ${esc(o.componentIds.map(name).join(', ') || o.requested?.join(', '))}</b><span>${ago(o.createdAt)}${o.error ? ` · ${esc(o.error)}` : ''}</span></div>
        <div class="su-item-act">${['completed'].includes(o.status) ? '' : pill(o.status)}${['failed', 'cancelled', 'interrupted'].includes(o.status) ? `<button class="btn btn-primary btn-sm" data-opretry="${o.id}">Retry</button>` : ''}</div></div>
        ${S.logOp === o.id && full ? `<div class="su-item-detail">${full.recovery ? `<p class="su-problem">${esc(full.recovery)}</p>` : ''}<div class="su-log">${full.log.map((l) => `${esc(l.ts.slice(11, 19))}  ${esc(l.msg)}`).join('\n')}</div></div>` : ''}</div>`).join('')}</div>` : '<p class="muted">Nothing installed from here yet.</p>'}
      <div class="su-row su-foot"><button class="btn-link" data-su="diag-copy">Copy diagnostic report</button><a class="btn-link" href="/api/setup/diagnostics?download=1">Export report</a><button class="btn-link" data-su="logs-open">Open log folder</button></div>`;
  }

  function renderHealth() {
    const el = $('#su-health-body'); if (!el) return;
    const h = S.health, NAMES = { ffmpeg: 'Video encoding (FFmpeg)', speech: 'Voice + word timing (Kokoro, Whisper)', webgl: 'Rendering (browser WebGL)', llm: 'Script model', comfyui: 'AI images (ComfyUI)', models: 'Model files', gpu: 'GPU', storage: 'Disk space', folders: 'Folders', ports: 'Ports', backend: 'Dashboard server', frontend: 'Dashboard files' };
    const order = Object.keys(NAMES);
    el.innerHTML = `<div class="su-row between su-gap"><span class="muted">${h ? `Last check ${ago(h.checkedAt)}` : 'Real tests: encodes a clip, speaks and times a sentence, renders WebGL.'}</span>
      <div class="su-row"><label class="su-small muted"><input type="checkbox" id="su-loadtest"> also start the script model and ComfyUI once (~1 min, uses the GPU)</label><button class="btn btn-primary btn-sm" data-su="health">${h ? 'Run again' : 'Run health check'}</button></div></div>
      ${h ? `<div class="su-list">${order.filter((k) => h.checks[k]).map((k) => { const c = h.checks[k]; return `<div class="su-item"><div class="su-item-main">
        <span class="su-dot ${TONE[c.status] || ''}"></span>
        <div class="su-item-text"><b>${NAMES[k]}</b><span>${esc(c.summary)}${c.hint ? ` — ${esc(c.hint)}` : ''}</span></div>
        <div class="su-item-act">${c.status !== 'healthy' ? pill(c.status) : ''}${c.status !== 'healthy' && c.repair?.componentId && c.repair.action !== 'manual' ? `<button class="btn btn-primary btn-sm" data-op="${c.repair.action}" data-id="${c.repair.componentId}">${c.repair.action === 'install' ? 'Install' : 'Repair'}</button>` : ''}</div></div></div>`; }).join('')}</div>` : ''}
      ${S.ov?.network ? `<p class="su-small muted">Download sources: ${S.ov.network.hosts.filter((x) => !x.reachable).length ? `unreachable: ${S.ov.network.hosts.filter((x) => !x.reachable).map((x) => esc(x.host)).join(', ')}` : 'all reachable'} · ${ago(S.ov.network.checkedAt)}</p>` : ''}
      <button class="btn-link" data-su="network">Check internet access to download sources</button>`;
  }

  function renderSettings() {
    const el = $('#su-settings-body'); if (!el) return;
    const c = S.config, hw = S.hw, st = S.storage;
    if (!c || !hw) { el.innerHTML = '<p class="muted">Loading…</p>'; return; }
    const groups = st ? [['Models', st.groups.models], ['Runtimes', st.groups.runtime], ['Projects', st.groups.projects], ['Videos', st.groups.exports], ['Cache & logs', { bytes: st.groups.cache.bytes + st.groups.logs.bytes + st.groups.downloads.bytes }]] : [];
    const tot = groups.reduce((a, [, g]) => a + g.bytes, 0) || 1;
    const cleanups = st ? st.cleanups.filter((x) => x.bytes > 0) : [];
    el.innerHTML = `
      <h4 class="su-h">Hardware</h4>
      <div class="su-radio">${hw.profiles.map((p) => { const [title, text] = PROFILE_TEXT[p.id] || [p.name, p.description]; const autoIsRec = hw.effective === hw.recommended; const rec = p.id === 'auto' ? autoIsRec : !autoIsRec && hw.recommended === p.id; return `<label class="${hw.setting === p.id ? 'on' : ''}"><input type="radio" name="su-prof" value="${p.id}" ${hw.setting === p.id ? 'checked' : ''}><b>${esc(title)}${rec ? ' <span class="su-tag">recommended</span>' : ''}${p.id === 'auto' ? ` <span class="muted su-small">· currently ${esc((PROFILE_TEXT[hw.effective] || [hw.effective])[0])}</span>` : ''}</b><span>${esc(text)}</span></label>`; }).join('')}</div>
      ${hw.warnings.map((w) => `<p class="su-problem">${esc(w)}</p>`).join('')}

      <h4 class="su-h">Storage</h4>
      ${st ? `<div class="su-stack">${groups.map(([k, g], i) => `<i class="c${i}" style="width:${(100 * g.bytes) / tot}%" title="${k}: ${B(g.bytes)}"></i>`).join('')}</div>
        <div class="su-legend">${groups.map(([k, g], i) => `<span><i class="c${i}"></i>${k} ${B(g.bytes)}</span>`).join('')}<span class="muted">${B(st.freeBytes)} free</span></div>
        ${cleanups.length ? `<div class="su-list">${cleanups.map((x) => `<div class="su-item"><div class="su-item-main"><div class="su-item-text"><b>${esc(x.name)}</b><span>${B(x.bytes)} can be freed</span></div><div class="su-item-act"><button class="btn btn-secondary btn-sm" data-clean="${x.id}">Clean up</button></div></div></div>`).join('')}</div>` : '<p class="muted su-small">Nothing to clean up.</p>'}` : '<p class="muted">Calculating…</p>'}

      <h4 class="su-h">Downloads</h4>
      <div class="su-form">
        <label>Downloads at the same time</label><input class="su-input" type="number" min="1" max="4" id="su-conc" value="${c.settings.downloadConcurrency}">
        <label>Connections per large file</label><input class="su-input" type="number" min="1" max="8" id="su-segs" value="${c.settings.downloadSegments}">
        <label>Offline mode</label><label class="su-small"><input type="checkbox" id="su-offline" ${c.settings.allowDownloads ? '' : 'checked'}> Never download; install only from files already on this PC</label>
        <span></span><div><button class="btn btn-primary btn-sm" data-su="save-settings">Save</button></div>
      </div>

      <details class="su-details"><summary>Folders</summary>
        <p class="muted su-small">Changing a folder does not move files. Restart CineForge afterwards. A backup of the configuration is kept.</p>
        <div class="su-list">${c.paths.map((p) => `<div class="su-item"><div class="su-item-main"><div class="su-item-text"><b>${esc({ 'models.kokoro': 'Voice model', 'models.whisperEnglish': 'English timing model', 'models.whisperMultilingual': 'Hindi timing model', 'models.llm': 'Script model', 'models.imageGeneration': 'Image model', exports: 'Finished videos', projects: 'Projects' }[p.key] || p.key)}</b><span>${esc(p.path)}${p.exists ? '' : ' · missing'}</span></div><div class="su-item-act"><button class="btn btn-secondary btn-sm" data-path="${esc(p.key)}">Change</button></div></div></div>`).join('')}</div>
      </details>`;
  }

  // ── events ───────────────────────────────────────────────────────────────────────────────────────────────
  async function onClick(e) {
    if (!e.target.closest('#screen-setup, #su-global-banner')) return;
    if (S.menu && !e.target.closest('.su-menu, [data-menu]')) { S.menu = null; renderTabsContent(); }
    const t = e.target.closest('[data-sutab],[data-su],[data-op],[data-dl],[data-filter],[data-toggle],[data-menu],[data-oplog],[data-opcancel],[data-opretry],[data-clean],[data-path]'); if (!t) return;
    if (t.dataset.toggle && e.target.closest('[data-stop]') && !t.matches('button')) return;
    const d = t.dataset;
    if (d.sutab) { S.tab = d.sutab; S.menu = null; render(); if (d.sutab === 'settings') { refresh(['config', 'hw']); if (!S.storage) refresh(['storage']); } if (d.sutab === 'health' && !S.health) refresh(['health']); return; }
    if (d.filter) { S.filter = d.filter; return renderComponents(); }
    if (d.menu) { S.menu = S.menu === d.menu ? null : d.menu; return renderTabsContent(); }
    if (d.toggle) { S.open.has(d.toggle) ? S.open.delete(d.toggle) : S.open.add(d.toggle); return renderTabsContent(); }
    if (d.op) { S.menu = null; return runOp(d.op, [d.id]); }
    if (d.dl) { if (d.dl === 'cancel' && !confirm('Cancel this download? The partial file is deleted.')) return; try { await api(`/api/setup/downloads/${d.id}/${d.dl}`, { method: 'POST' }); refresh(['dls', 'ov']); } catch (x) { toast(x.message); } return; }
    if (d.oplog) { S.logOp = S.logOp === d.oplog ? null : d.oplog; return renderActivity(); }
    if (d.opcancel) { if (confirm('Cancel? Components that already finished are kept.')) api(`/api/setup/ops/${d.opcancel}/cancel`, { method: 'POST' }).catch((x) => toast(x.message)); return; }
    if (d.opretry) { try { await api(`/api/setup/ops/${d.opretry}/retry`, { method: 'POST' }); refresh(['ops']); } catch (x) { toast(x.message); } return; }
    if (d.clean) { const c = S.storage.cleanups.find((x) => x.id === d.clean); if (!confirm(`Delete ${c.name} (${B(c.bytes)})?\nProjects, videos and installed models are not touched.`)) return; try { const r = await api('/api/setup/storage/cleanup', { method: 'POST', body: { id: d.clean, confirm: true } }); toast(`Freed ${B(r.bytes)}`); S.storage = null; refresh(['storage', 'dls']); } catch (x) { toast(x.message); } return; }
    if (d.path) {
      const cur = S.config.paths.find((p) => p.key === d.path); const v = prompt('New folder (files are not moved; restart afterwards):', cur.path); if (!v || v === cur.path) return;
      try { const chk = await api('/api/setup/config/validate-path', { method: 'POST', body: { value: v } }); if (!chk.ok) return toast(`✖ ${chk.error}`); await api('/api/setup/config/path', { method: 'POST', body: { key: d.path, value: v, confirm: true } }); toast('Saved. Restart CineForge to use the new folder.'); refresh(['config']); } catch (x) { toast(x.message); }
      return;
    }
    switch (d.su) {
      case 'scan': return scan();
      case 'network': try { await api('/api/setup/network', { method: 'POST' }); refresh(['ov']); } catch (x) { toast(x.message); } return;
      case 'preset-required': return runOp('install', null, 'required');
      case 'preset-recommended': return runOp('install', null, 'recommended');
      case 'repair-broken': return runOp('repair', S.comps.filter((c) => ['failed', 'incompatible'].includes(c.state.status) && auto(c)).map((c) => c.id));
      case 'verify-all': return runOp('verify', S.comps.filter((c) => OK(c.state.status)).map((c) => c.id));
      case 'health': t.disabled = true; t.textContent = 'Checking…'; try { S.health = await api('/api/setup/health', { method: 'POST', body: { loadTest: $('#su-loadtest')?.checked === true } }); } catch (x) { toast(x.message); } return render();
      case 'save-settings': try { await api('/api/setup/config', { method: 'POST', body: { downloadConcurrency: +$('#su-conc').value, downloadSegments: +$('#su-segs').value, allowDownloads: !$('#su-offline').checked } }); toast('Saved'); refresh(['config', 'ov']); } catch (x) { toast(`✖ ${x.message}`); } return;
      case 'diag-copy': try { await navigator.clipboard.writeText(JSON.stringify(await api('/api/setup/diagnostics'), null, 2)); toast('Copied (no passwords or keys; your user folder is hidden)'); } catch (x) { toast(x.message); } return;
      case 'logs-open': api('/api/setup/logs/open', { method: 'POST' }).catch((x) => toast(x.message)); return;
    }
  }
  function renderTabsContent() { ({ overview: renderOverview, components: renderComponents, activity: renderActivity })[S.tab]?.(); }
  async function onChange(e) {
    if (e.target.name !== 'su-prof') return;
    try { await api('/api/setup/config', { method: 'POST', body: { hardwareProfile: e.target.value } }); refresh(['hw', 'ov']); } catch (x) { toast(x.message); }
  }

  async function start() {
    if (S.started) return; S.started = true;
    document.addEventListener('click', onClick); document.addEventListener('change', onChange);
    try { await session(); } catch {}
    await refresh(['ov', 'comps', 'dls', 'ops', 'health']);
    if (!S.ov?.lastScanAt) scan();
    refresh(['config', 'hw']); refresh(['storage']);   // background: Settings opens instantly later
    connect();
  }
  window.SetupUI = { show: () => { start(); render(); }, start };
  // load early so the Dashboard can say "setup needed" on a new PC, and open System Setup only in that case
  document.addEventListener('DOMContentLoaded', () => { start().then(() => { const n = nextStep(); if (n && n.title === 'Setup needed' && !location.hash) document.querySelector('.nav-item[data-screen="setup"]')?.click(); }); });
})();
