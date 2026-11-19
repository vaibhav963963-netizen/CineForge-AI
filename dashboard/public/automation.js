// Automation screen: scheduler heartbeat, controls, runs with stage checkpoints, dead-letter queue, settings, health
// and events. Reads/writes through /api/automation (the scheduler itself is a separate background process).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STAGES = ['topic', 'script', 'render', 'qa', 'metadata', 'upload', 'publish', 'record'];
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const fmt = (iso, tz) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: tz || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '–');
  let data = null, timer = null;

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    // server error shape: { error: "message", ...extra } (e.g. { error, errors: [...] } for invalid settings)
    if (!r.ok) throw Object.assign(new Error((typeof j.error === 'string' ? j.error : j.error?.message) || j.message || r.statusText), { data: j });
    return j;
  }
  const command = async (c) => { try { await api('/api/automation/command', { method: 'POST', body: { command: c } }); flash(`"${c}" sent — applied on the scheduler's next tick (≤ 30 s)`); setTimeout(load, 1500); } catch (e) { flash(e.message, true); } };
  function flash(msg, bad) { const el = $('#au-flash'); if (!el) return; el.textContent = msg; el.className = `au-flash ${bad ? 'bad' : 'good'}`; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 6000); }

  function statusCard(d) {
    const hb = d.heartbeat, s = d.settings;
    const alive = hb && hb.ageSeconds < 120 && hb.state !== 'stopped';
    const next = d.runs.find((r) => ['queued', 'running', 'waiting_retry'].includes(r.status));
    return `<div class="au-status">
      <div><span class="au-dot ${alive ? 'ok' : 'bad'}"></span><b>Scheduler</b> ${alive ? `${esc(hb.state)} · heartbeat ${hb.ageSeconds}s ago · pid ${hb.pid}` : hb ? `<span class="au-bad">not running</span> (last heartbeat ${fmt(hb.at, s.timeZone)})` : '<span class="au-bad">never started</span>'}</div>
      <div><b>Automation</b> ${s.enabled ? '<span class="au-good">enabled</span>' : '<span class="au-warn">off</span>'} · mode <b>${esc(d.mode)}</b> · produce ${esc(s.productionTime)} · publish ${esc(s.publishTime)} (${esc(s.timeZone)}) · ${esc(s.publishMode)}</div>
      <div><b>Now</b> ${next ? `${esc(next.slot)} — ${esc(next.status)} at stage <b>${esc(next.stage)}</b>${next.next_attempt_at ? ` · next attempt ${fmt(next.next_attempt_at, s.timeZone)}` : ''}` : 'nothing pending'}</div>
      <div><b>YouTube</b> ${d.youtube ? (d.youtube.authorized ? `<span class="au-good">authorized</span> · quota ${d.youtube.quotaUsedToday ?? 0}/${d.youtube.quotaDaily}` : d.youtube.clientSecret ? '<span class="au-warn">not authorized</span> — run <code>node automation/youtube.mjs authorize</code>' : '<span class="au-warn">not set up</span> (see docs/automation.md)') : '–'}</div>
      ${alive ? '' : '<div class="au-hint">Start it: <code>node automation/scheduler.mjs</code> — or install it to start with Windows: <code>powershell -ExecutionPolicy Bypass -File automation\\install-startup.ps1</code></div>'}
    </div>
    <div class="au-controls">
      <button class="btn btn-secondary btn-sm" data-cmd="pause">Pause</button><button class="btn btn-secondary btn-sm" data-cmd="resume">Resume</button>
      <button class="btn btn-secondary btn-sm" data-cmd="run-now">Run one now</button><button class="btn btn-danger btn-sm" data-cmd="stop">Emergency stop</button>
      <button class="btn btn-secondary btn-sm" id="au-health-btn">Run health check</button>
    </div>`;
  }

  function runsTable(d) {
    if (!d.runs.length) return '<p class="muted">No runs yet. Runs appear here when automation is enabled and a production slot is due (or after "Run one now").</p>';
    const tz = d.settings.timeZone;
    return `<table class="jobs-table au-runs"><thead><tr><th>Slot</th><th>Topic</th><th>Status</th><th>Stages</th><th>Attempt</th><th>Next / result</th><th></th></tr></thead><tbody>${d.runs.map((r) => {
      const cp = Object.fromEntries((d.checkpoints[r.id] || []).map((c) => [c.stage, c.status]));
      const chips = STAGES.map((st) => `<span class="au-chip ${cp[st] === 'done' ? 'done' : cp[st] === 'skipped' ? 'skip' : st === r.stage && r.status !== 'published' ? (r.status === 'dead' ? 'dead' : 'cur') : ''}" title="${st}${cp[st] ? `: ${cp[st]}` : ''}">${st}</span>`).join('');
      const res = r.status === 'published' ? (r.youtube_url ? `<a href="${esc(r.youtube_url)}" target="_blank" rel="noopener">${esc(r.youtube_url)}</a>` : 'complete')
        : r.status === 'dead' ? `<span class="au-bad">${esc(r.failure_class)}: ${esc((r.last_error || '').slice(0, 140))}</span>`
        : r.status === 'awaiting_publish' ? `ready — publish manually (${esc(r.video_path || '')})`
        : r.next_attempt_at ? `${fmt(r.next_attempt_at, tz)}${r.last_error ? ` · <span class="au-warn">${esc(r.failure_class)}</span>` : ''}` : '';
      return `<tr><td>${esc(r.slot)}</td><td>${esc(r.topic || '–')}</td><td><span class="st-${esc(r.status)}">${esc(r.status)}</span></td><td>${chips}</td><td>${r.attempt}</td><td>${res}</td><td>${['dead', 'failed', 'waiting_retry'].includes(r.status) ? `<button class="btn btn-secondary btn-sm" data-cmd="requeue:${esc(r.id)}">Requeue</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function settingsForm(d) {
    const s = d.settings, day = (k) => DAYS.map((x) => `<label class="au-day"><input type="checkbox" name="${k}" value="${x}" ${s[k].includes(x) ? 'checked' : ''}>${x}</label>`).join('');
    const num = (k, label, step = 1) => `<label>${label}<input type="number" name="${k}" value="${s[k]}" step="${step}"></label>`;
    return `<form id="au-settings" class="au-form">
      <label class="au-wide"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> <b>Automation enabled</b> — produce on schedule, unattended</label>
      <label>Time zone<input name="timeZone" value="${esc(s.timeZone)}"></label>
      <label>Production time<input type="time" name="productionTime" value="${esc(s.productionTime)}"></label>
      <div class="au-wide">Production days ${day('productionDays')}</div>
      <label>Publish time<input type="time" name="publishTime" value="${esc(s.publishTime)}"></label>
      <div class="au-wide">Publish days ${day('publishDays')}</div>
      <label>Publish mode<select name="publishMode">${['manual', 'private-upload', 'scheduled-public'].map((m) => `<option ${m === s.publishMode ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label>Unattended script gate<select name="scriptGate"><option value="ready" ${s.scriptGate === 'ready' ? 'selected' : ''}>READY scripts only</option><option value="allow-needs-review" ${s.scriptGate === 'allow-needs-review' ? 'selected' : ''}>also NEEDS_REVIEW (not recommended)</option></select></label>
      ${num('maxVideosPerDay', 'Max videos per day')}${num('retryCount', 'Retry count')}
      <label>Retry slots (minutes after the first attempt)<input name="retrySlotsMinutes" value="${esc(s.retrySlotsMinutes.join(', '))}"></label>
      <label>Recovery window<span class="au-pair"><input type="time" name="recoveryWindow.start" value="${esc(s.recoveryWindow.start)}"><input type="time" name="recoveryWindow.end" value="${esc(s.recoveryWindow.end)}"></span></label>
      <label>Quiet hours<span class="au-pair"><input type="time" name="quietHours.start" value="${esc(s.quietHours.start)}"><input type="time" name="quietHours.end" value="${esc(s.quietHours.end)}"></span></label>
      ${num('minFreeDiskGB', 'Minimum free disk (GB)')}${num('minFreeRamGB', 'Minimum free RAM (GB)', 0.5)}${num('minFreeVramGB', 'Minimum free VRAM (GB)', 0.5)}
      <label class="au-wide"><input type="checkbox" name="allowCatchUpPublishing" ${s.allowCatchUpPublishing ? 'checked' : ''}> Allow catch-up publishing (several overdue videos in one slot)</label>
      <label class="au-wide">Topic queue (one per line — used first, never repeated)<textarea name="topicQueue" rows="4">${esc((s.topicQueue || []).join('\n'))}</textarea></label>
      <label>Topic source when the queue is empty<select name="topicSource"><option ${s.topicSource === 'queue' ? 'selected' : ''}>queue</option><option ${s.topicSource === 'trends' ? 'selected' : ''}>trends</option></select></label>
      <label>Studio URL<input name="studio.url" value="${esc(s.studio.url)}"></label>
      <label>Language<input name="studio.language" value="${esc(s.studio.language)}"></label>
      <label>Voice<input name="studio.voice" value="${esc(s.studio.voice)}"></label>
      <label>Duration (s)<input type="number" name="studio.durationSeconds" value="${s.studio.durationSeconds}"></label>
      <div class="au-wide"><button class="btn btn-primary btn-sm" type="submit">Save settings</button> <span class="muted">Saved settings apply on the scheduler's next tick.</span></div>
      <div id="au-errors" class="au-errors" hidden></div>
    </form>`;
  }
  function readForm(form, s) {
    const f = new FormData(form), out = { ...s, studio: { ...s.studio }, recoveryWindow: { ...s.recoveryWindow }, quietHours: { ...s.quietHours } };
    out.enabled = form.enabled.checked; out.allowCatchUpPublishing = form.allowCatchUpPublishing.checked;
    for (const k of ['timeZone', 'productionTime', 'publishTime', 'publishMode', 'scriptGate', 'topicSource']) out[k] = f.get(k);
    for (const k of ['maxVideosPerDay', 'retryCount', 'minFreeDiskGB']) out[k] = parseInt(f.get(k), 10);
    for (const k of ['minFreeRamGB', 'minFreeVramGB']) out[k] = parseFloat(f.get(k));
    out.productionDays = f.getAll('productionDays'); out.publishDays = f.getAll('publishDays');
    out.retrySlotsMinutes = String(f.get('retrySlotsMinutes')).split(/[,\s]+/).filter(Boolean).map(Number);
    out.recoveryWindow = { start: f.get('recoveryWindow.start'), end: f.get('recoveryWindow.end') };
    out.quietHours = { start: f.get('quietHours.start'), end: f.get('quietHours.end') };
    out.topicQueue = String(f.get('topicQueue')).split('\n').map((x) => x.trim()).filter(Boolean);
    out.studio = { ...out.studio, url: f.get('studio.url'), language: f.get('studio.language'), voice: f.get('studio.voice'), durationSeconds: parseInt(f.get('studio.durationSeconds'), 10) };
    return out;
  }

  const healthHtml = (h) => !h ? '<p class="muted">Run a health check to see disk, RAM, GPU, models, FFmpeg, studio and YouTube status.</p>'
    : `<ul class="au-health">${(h.checks || []).map((c) => `<li class="${c.ok ? 'ok' : c.severity}"><b>${esc(c.check)}</b> ${esc(c.detail)}</li>`).join('')}</ul>`;
  const eventsHtml = (d) => `<div class="au-events">${d.events.map((e) => `<div class="au-ev ${esc(e.level)}"><span>${fmt(e.at, d.settings.timeZone)}</span> ${e.run_id ? `<code>${esc(e.run_id.slice(-10))}</code> ` : ''}${esc(e.message)}</div>`).join('') || '<p class="muted">No events yet.</p>'}</div>`;

  function render(d) {
    const root = $('#automation-root'); if (!root) return;
    const open = root.querySelector('#au-settings') ? root.querySelector('details.au-set')?.open : false;
    root.innerHTML = `<div id="au-flash" class="au-flash" hidden></div>
      <div class="panel"><div class="panel-header"><div><h3>Scheduler</h3><p>Runs in the background, independent of this dashboard</p></div></div>${statusCard(d)}</div>
      <div class="panel"><div class="panel-header"><div><h3>Runs</h3><p>Each run = one video: topic → script → render → QA → metadata → upload → publish. Finished stages are never redone.</p></div></div>${runsTable(d)}</div>
      <div class="panel"><details class="au-set" ${open ? 'open' : ''}><summary><b>Automation settings</b></summary>${settingsForm(d)}</details></div>
      <div class="panel"><div class="panel-header"><div><h3>Health</h3></div></div><div id="au-health">${healthHtml(d.health)}</div></div>
      <div class="panel"><div class="panel-header"><div><h3>Events</h3><p>Latest 80 · retries, failures, recoveries</p></div></div>${eventsHtml(d)}</div>`;
    root.querySelectorAll('[data-cmd]').forEach((b) => (b.onclick = () => { if (b.dataset.cmd === 'stop' && !confirm('Emergency stop: cancel the running job and pause automation?')) return; command(b.dataset.cmd); }));
    $('#au-health-btn').onclick = async () => { $('#au-health').innerHTML = '<p class="muted">Checking…</p>'; try { const r = await api('/api/automation?health=1'); $('#au-health').innerHTML = healthHtml(r.health); } catch (e) { $('#au-health').textContent = e.message; } };
    $('#au-settings').onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('/api/automation/settings', { method: 'POST', body: { settings: readForm(ev.target, d.settings) } }); flash('Settings saved'); load(); }
      catch (e) { const box = $('#au-errors'); box.hidden = false; box.innerHTML = (e.data?.errors || [e.message]).map((x) => `<div>✖ ${esc(x)}</div>`).join(''); }
    };
  }
  async function load() { try { data = await api('/api/automation'); render(data); } catch (e) { const r = $('#automation-root'); if (r) r.innerHTML = `<p class="au-bad">Could not load automation state: ${esc(e.message)}</p>`; } }
  window.AutomationUI = {
    show() { load(); clearInterval(timer); timer = setInterval(() => { if (document.querySelector('#screen-automation.active') && !document.querySelector('#au-settings:focus-within')) load(); }, 10000); },
  };
})();
