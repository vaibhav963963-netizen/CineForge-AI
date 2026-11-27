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
  // every button shows that it is working: disabled, "…" on the button, and the result in the small note beside it
  async function act(btn, busyText, fn, okText = 'Done ✓') {
    if (!btn || btn.disabled) return;
    const label = btn.textContent, note = btn.parentElement?.querySelector('.au-note');
    btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'wait'; btn.textContent = busyText;
    if (note) { note.className = 'au-note'; note.textContent = ''; }
    try {
      const msg = await fn();
      btn.textContent = okText;
      if (note) { note.className = 'au-note au-good'; note.textContent = typeof msg === 'string' ? msg : 'Done.'; }
      return msg;
    } catch (e) {
      btn.textContent = 'Failed';
      if (note) { note.className = 'au-note au-bad'; note.textContent = e.message; }
      flash(e.message, true);
    } finally {
      setTimeout(() => { if (btn.isConnected) { btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = ''; btn.textContent = label; } }, 2500);
    }
  }

  function flash(msg, bad) { const el = $('#au-flash'); if (!el) return; el.textContent = msg; el.className = `au-flash ${bad ? 'bad' : 'good'}`; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 6000); }

  // Automation card: ON/OFF, scheduler state in plain words, the schedule, and three buttons at most
  function automationCard(d) {
    const hb = d.heartbeat, st = d.settings;
    const alive = hb && hb.ageSeconds < 120 && hb.state !== 'stopped';
    const paused = d.mode === 'paused';
    const on = !!st.enabled;
    const sched = !alive ? '<span class="au-bad">stopped</span>' : paused ? '<span class="au-warn">paused</span>' : '<span class="au-good">running</span>';
    const next = d.runs.find((r) => ['queued', 'running', 'waiting_retry'].includes(r.status));
    return `<h3>Automation</h3>
      <p style="font-size:22px; margin:6px 0;"><b>${on ? '<span class="au-good">ON</span>' : '<span class="au-warn">OFF</span>'}</b></p>
      <p>Scheduler: ${sched}</p>
      <p>Videos per day: <b>${esc(st.maxVideosPerDay)}</b> · produce at <b>${esc(st.productionTime)}</b> · publish at <b>${esc(st.publishTime)}</b> (India time)</p>
      <p>Now: ${next ? `${esc(next.status)} (${esc(next.stage)})` : 'nothing running'}</p>
      ${alive ? '' : '<p class="au-hint">The scheduler is not running. It starts when you log in to Windows. To start it now, run <code>node automation/scheduler.mjs</code>.</p>'}
      <div class="au-controls">
        <button class="btn btn-primary btn-sm" id="au-toggle">${on ? 'Turn automation off' : 'Turn automation on'}</button>
        ${paused && alive ? '<button class="btn btn-secondary btn-sm" id="au-resume">Resume scheduler</button>' : ''}
        <button class="btn btn-danger btn-sm" id="au-stop">Stop now</button>
        <span class="au-note"></span>
      </div>`;
  }

  // YouTube card: who is connected (from the stored, API-confirmed channel), and connect / disconnect
  function youtubeCard(d) {
    const yt = d.youtube || {}, ch = yt.channel;
    if (!yt.clientSecret) return '<h3>YouTube</h3><p class="au-bad">The YouTube OAuth file is not set up (see YOUTUBE_CLIENT_SECRET_FILE in .env).</p>';
    if (!yt.authorized) return `<h3>YouTube</h3><p>Not connected.</p>
      <div class="au-controls"><button class="btn btn-primary btn-sm" id="au-yt-connect">Connect YouTube</button><span class="au-note"></span></div>`;
    return `<h3>YouTube</h3>
      <p>Connected to: <b>${esc(ch?.channelTitle || 'channel not confirmed yet')}</b>${ch?.customUrl ? ` <span class="muted">(${esc(ch.customUrl)})</span>` : ''}</p>
      <p class="muted">API quota used today: ${yt.quotaUsedToday ?? 0} / ${yt.quotaDaily || 10000}</p>
      <div class="au-controls"><button class="btn btn-danger btn-sm" id="au-yt-disconnect">Disconnect</button><span class="au-note"></span></div>`;
  }

  function runsTable(d) {
    if (!d.runs.length) return '<p class="muted">No runs yet. Runs appear here when automation is enabled and a production slot is due (or after "Run one now").</p>';
    const tz = d.settings.timeZone;
    return `<table class="jobs-table au-runs"><thead><tr><th>Slot</th><th>Topic</th><th>Status</th><th>Stages</th><th>Attempt</th><th>Next / result</th><th>Actions</th></tr></thead><tbody>${d.runs.map((r) => {
      const cp = Object.fromEntries((d.checkpoints[r.id] || []).map((c) => [c.stage, c.status]));
      const chips = STAGES.map((st) => `<span class="au-chip ${cp[st] === 'done' ? 'done' : cp[st] === 'skipped' ? 'skip' : st === r.stage && r.status !== 'published' ? (r.status === 'dead' ? 'dead' : 'cur') : ''}" title="${st}${cp[st] ? `: ${cp[st]}` : ''}">${st}</span>`).join('');
      const res = r.status === 'published' ? (r.youtube_url ? `<a href="${esc(r.youtube_url)}" target="_blank" rel="noopener">${esc(r.youtube_url)}</a>` : 'complete')
        : r.status === 'dead' ? `<span class="au-bad">${esc(r.failure_class)}: ${esc((r.last_error || '').slice(0, 140))}</span>`
        : r.status === 'awaiting_publish' ? `ready — waiting for manual publish`
        : r.next_attempt_at ? `${fmt(r.next_attempt_at, tz)}${r.last_error ? ` · <span class="au-warn">${esc(r.failure_class)}</span>` : ''}` : '';
      const act = ['dead', 'failed', 'waiting_retry'].includes(r.status)
        ? `<button class="btn btn-secondary btn-sm" data-cmd="requeue:${esc(r.id)}">Retry</button>`
        : (r.status === 'awaiting_publish' ? `<button class="btn btn-primary btn-sm" data-publish="${esc(r.id)}">Manual Publish</button>` : '');
      return `<tr><td>${esc(r.slot)}</td><td>${esc(r.topic || '–')}</td><td><span class="st-${esc(r.status)}">${esc(r.status)}</span></td><td>${chips}</td><td>${r.attempt}</td><td>${res}</td><td>${act}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  // The settings the owner actually changes. Everything else (retries, backoff, quiet hours, catch-up, time-zone
  // details, concurrency) keeps its tested default in automation/settings.mjs and is not shown here.
  function settingsForm(d) {
    const s = d.settings;
    const MODES = [['manual', 'Manual — produce only; I upload'], ['auto', 'Auto — upload as soon as the video is ready (visibility from .env)'], ['scheduled-public', 'Scheduled — upload private, YouTube publishes at the publish time']];
    return `<form id="au-settings" class="au-form">
      <label class="au-wide"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> <b>Automation enabled</b> — produce and publish on schedule, unattended</label>
      <label>Produce at (daily)<input type="time" name="productionTime" value="${esc(s.productionTime)}"></label>
      <label>Publish at (daily)<input type="time" name="publishTime" value="${esc(s.publishTime)}"></label>
      <label>Videos per day<input type="number" name="maxVideosPerDay" min="1" max="10" value="${s.maxVideosPerDay}"></label>
      <label>Publish mode<select name="publishMode">${MODES.map(([v, t]) => `<option value="${v}" ${v === s.publishMode ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>YouTube visibility<select name="youtubePrivacy">${['private','public','unlisted'].map((v) => `<option value="${v}" ${s.youtubePrivacy === v ? 'selected' : ''}>${v === 'private' ? 'Private (only you)' : v === 'public' ? 'Public' : 'Unlisted'}</option>`).join('')}</select></label>
      <p class="au-wide muted">Topics: add them in <a href="#scriptbook" data-goto="scriptbook">Topic Book</a>. Automation takes them from the top of that list.</p>
      <label>Minimum free disk (GB)<input type="number" name="minFreeDiskGB" min="1" value="${s.minFreeDiskGB}"></label>
      <p class="au-wide muted">Scripts are approved automatically (no manual review). Time zone is Asia/Kolkata.</p>
      <div class="au-wide"><button class="btn btn-primary btn-sm" type="submit">Save settings</button> <span class="au-note"></span> <span class="muted">Applies on the scheduler's next tick.</span></div>
      <div id="au-errors" class="au-errors" hidden></div>
    </form>`;
  }

  // only the fields this form owns are sent (stored bookkeeping keys are never sent back)
  function readForm(form) {
    const f = new FormData(form);
    return {
      enabled: form.enabled.checked,
      productionTime: f.get('productionTime'), publishTime: f.get('publishTime'),
      maxVideosPerDay: parseInt(f.get('maxVideosPerDay'), 10),
      publishMode: f.get('publishMode'), youtubePrivacy: f.get('youtubePrivacy'),
      minFreeDiskGB: parseInt(f.get('minFreeDiskGB'), 10),
    };
  }

  const healthHtml = (h) => !h ? '<p class="muted">Run a health check to see disk, RAM, GPU, models, FFmpeg, studio and YouTube status.</p>'
    : `<ul class="au-health">${(h.checks || []).map((c) => `<li class="${c.ok ? 'ok' : c.severity}"><b>${esc(c.check)}</b> ${esc(c.detail)}</li>`).join('')}</ul>`;
  const eventsHtml = (d) => `<div class="au-events">${d.events.map((e) => `<div class="au-ev ${esc(e.level)}"><span>${fmt(e.at, d.settings.timeZone)}</span> ${e.run_id ? `<code>${esc(e.run_id.slice(-10))}</code> ` : ''}${esc(e.message)}</div>`).join('') || '<p class="muted">No events yet.</p>'}</div>`;

  function render(d) {
    const root = $('#automation-root'); if (!root) return;
    const open = root.querySelector('details.au-set')?.open;
    root.innerHTML = `<div id="au-flash" class="au-flash" hidden></div>
      <div class="panel">${automationCard(d)}</div>
      <div class="panel">${youtubeCard(d)}</div>
      <div class="panel"><div class="panel-header"><div><h3>Videos</h3><p>Each video: script, render, checks, captions, cover, upload.</p></div></div>${runsTable(d)}</div>
      <div class="panel"><details class="au-set" ${open ? 'open' : ''}><summary><b>Settings</b></summary>${settingsForm(d)}</details></div>
      <div class="panel"><details><summary><b>Health and events</b></summary>
        <div class="au-controls"><button class="btn btn-secondary btn-sm" id="au-health-btn">Check health</button><span class="au-note"></span></div>
        <div id="au-health">${healthHtml(d.health)}</div>${eventsHtml(d)}</details></div>`;

    const toggleBtn = $('#au-toggle');
    toggleBtn.onclick = () => act(toggleBtn, 'Saving…', async () => {
      await api('/api/automation/settings', { method: 'POST', body: { settings: { enabled: !d.settings.enabled } } });
      setTimeout(load, 800);
      return d.settings.enabled ? 'Automation is now OFF.' : 'Automation is now ON (applies within 30 s).';
    });
    const resumeBtn = $('#au-resume');
    if (resumeBtn) resumeBtn.onclick = () => act(resumeBtn, 'Resuming…', async () => {
      await api('/api/automation/command', { method: 'POST', body: { command: 'resume' } }); setTimeout(load, 1500);
      return 'Scheduler resumed (applies within 30 s).';
    });
    const stopBtn = $('#au-stop');
    stopBtn.onclick = () => { if (confirm('Stop now: cancel the running job and turn automation off?')) act(stopBtn, 'Stopping…', async () => {
      await api('/api/automation/command', { method: 'POST', body: { command: 'stop' } }); setTimeout(load, 1500);
      return 'Stop sent (applies within 30 s).';
    }); };
    root.querySelectorAll('[data-cmd]').forEach((b) => (b.onclick = () => act(b, 'Sending…', async () => {
      await api('/api/automation/command', { method: 'POST', body: { command: b.dataset.cmd } }); setTimeout(load, 1500);
      return 'Sent (applies within 30 s).';
    })));
    root.querySelectorAll('[data-publish]').forEach((b) => (b.onclick = () => act(b, 'Queuing…', async () => {
      await api(`/api/automation/runs/${b.dataset.publish}/publish`, { method: 'POST' }); setTimeout(load, 1000);
      return 'Queued for upload.';
    })));
    const connectBtn = $('#au-yt-connect');
    if (connectBtn) connectBtn.onclick = () => act(connectBtn, 'Opening…', async () => {
      const r = await api('/api/automation/youtube/connect', { method: 'POST' });
      return r.message || 'Sign-in page opened in your browser.';
    }, 'Opened ✓');
    const discBtn = $('#au-yt-disconnect');
    if (discBtn) discBtn.onclick = () => { if (confirm('Disconnect the YouTube account from CineForge?')) act(discBtn, 'Disconnecting…', async () => {
      const r = await api('/api/automation/youtube/disconnect', { method: 'POST' }); setTimeout(load, 800);
      return r.detail || 'Disconnected.';
    }); };
    const healthBtn = $('#au-health-btn');
    healthBtn.onclick = () => act(healthBtn, 'Checking…', async () => {
      const r = await api('/api/automation?health=1'); $('#au-health').innerHTML = healthHtml(r.health);
      return 'Health checked.';
    }, 'Checked ✓');
    const form = $('#au-settings');
    if (form) form.onsubmit = (ev) => {
      ev.preventDefault();
      const submit = ev.target.querySelector('button[type=submit]');
      act(submit, 'Saving…', async () => {
        await api('/api/automation/settings', { method: 'POST', body: { settings: readForm(ev.target) } });
        setTimeout(load, 600);
        return 'Settings saved.';
      }, 'Saved ✓');
    };
  }

  async function load() { try { data = await api('/api/automation'); render(data); } catch (e) { const r = $('#automation-root'); if (r) r.innerHTML = `<p class="au-bad">Could not load automation state: ${esc(e.message)}</p>`; } }
  window.AutomationUI = {
    show() { load(); clearInterval(timer); timer = setInterval(() => { if (document.querySelector('#screen-automation.active') && !document.querySelector('#au-settings:focus-within')) load(); }, 10000); },
  };
})();
