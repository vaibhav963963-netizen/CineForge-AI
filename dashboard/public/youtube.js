// YouTube page: auto-publish switch, visibility, and the publishing status of every automated Short (live from YouTube).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '–');
  let root = null, data = null;

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((typeof j.error === 'string' ? j.error : j.error?.message) || r.statusText);
    return j;
  }

  // one plain status per Short
  function statusOf(v) {
    const y = v.youtube;
    if (v.videoId && y) {
      if (y.privacy === 'public') return ['Published', 'au-good', y.publishedAt];
      if (y.publishAt) return ['Scheduled', 'au-warn', y.publishAt];
      return [y.privacy === 'unlisted' ? 'Unlisted' : 'Private', 'muted', v.uploadedAt];
    }
    if (v.videoId) return ['Uploaded', 'muted', v.uploadedAt];
    if (v.runStatus === 'dead') return ['Failed', 'au-bad', null];
    if (v.runStatus === 'waiting_retry') return ['Retrying', 'au-warn', null];
    return [`Making (${v.stage})`, 'muted', null];
  }

  // a publish time can change until the Short is public
  const editable = (v) => !(v.youtube && v.youtube.privacy === 'public') && v.runStatus !== 'dead';
  // ISO → "YYYY-MM-DDTHH:MM" in India time for the datetime input; and back (+05:30)
  const istLocal = (iso) => { if (!iso) return ''; const d = new Date(new Date(iso).getTime() + 330 * 60000); return d.toISOString().slice(0, 16); };
  const fromIst = (val) => new Date(`${val}:00+05:30`).toISOString();

  function paint() {
    const s = data.settings, auto = s.publishMode !== 'manual';
    const list = data.videos;
    const counts = list.reduce((m, v) => { const k = statusOf(v)[0].split(' ')[0]; m[k] = (m[k] || 0) + 1; return m; }, {});
    root.innerHTML = `<div class="panel">
        <h3>Auto-publish Shorts</h3>
        <p style="font-size:20px; margin:6px 0;"><b>${auto ? '<span class="au-good">ON</span>' : '<span class="au-warn">OFF</span>'}</b></p>
        <p>${auto ? `Each automated Short is uploaded when it is ready${s.publishMode === 'scheduled-public' && s.youtubePrivacy === 'public' ? ` and goes public at <b>${esc(s.publishTime)}</b> (India time)` : ''}.` : 'Shorts are made but not uploaded.'}</p>
        <div class="au-controls" style="display:flex; gap:10px; align-items:end; flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" id="yt-auto">${auto ? 'Turn auto-publish off' : 'Turn auto-publish on'}</button>
          <label>Visibility <select id="yt-priv">${['private', 'public', 'unlisted'].map((v) => `<option value="${v}" ${s.youtubePrivacy === v ? 'selected' : ''}>${v === 'private' ? 'Private (only you)' : v === 'public' ? 'Public' : 'Unlisted'}</option>`).join('')}</select></label>
          <button class="btn btn-secondary btn-sm" id="yt-refresh">Refresh status</button>
          <span id="yt-note" class="au-note"></span>
        </div>
      </div>
      <div class="panel">
        <h3>Shorts (${list.length})</h3>
        <p class="muted">${Object.entries(counts).map(([k, n]) => `${esc(k)}: ${n}`).join(' · ') || 'No Shorts yet.'}${data.liveError ? ` · <span class="au-bad">YouTube status unavailable: ${esc(data.liveError)}</span>` : ''}</p>
        ${list.length ? `<table class="jobs-table"><thead><tr><th>Short</th><th>Status</th><th>Time</th><th>Publish at (India time)</th><th>Views</th><th>Link</th></tr></thead><tbody>${list.map((v) => {
          const [st, cls, t] = statusOf(v);
          return `<tr><td>${esc(v.youtube?.title || v.topic || '–')}</td><td><span class="${cls}">${esc(st)}</span>${st === 'Failed' && v.lastError ? `<div class="muted" style="font-size:12px;">${esc(v.lastError.slice(0, 120))}</div>` : ''}</td>
            <td>${esc(when(t))}</td><td>${editable(v) ? `<input type="datetime-local" data-when="${esc(v.runId)}" value="${istLocal(v.youtube?.publishAt || v.scheduledFor)}"> <button class="btn btn-secondary btn-sm" data-save="${esc(v.runId)}">Save</button> <span class="au-note" data-note="${esc(v.runId)}"></span>` : esc(when(v.youtube?.publishAt || v.scheduledFor))}</td><td>${v.youtube?.views ?? '–'}</td><td>${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">Open</a>` : '–'}</td></tr>`;
        }).join('')}</tbody></table>` : ''}
      </div>`;
    const note = $('#yt-note');
    const save = async (settings, msg) => {
      note.className = 'au-note'; note.textContent = 'Saving…';
      try { await api('/api/automation/settings', { method: 'POST', body: { settings } }); note.className = 'au-note au-good'; note.textContent = msg; await load(); }
      catch (e) { note.className = 'au-note au-bad'; note.textContent = e.message; }
    };
    $('#yt-auto').onclick = (ev) => { ev.target.disabled = true; save({ publishMode: auto ? 'manual' : 'scheduled-public' }, auto ? 'Auto-publish is OFF.' : 'Auto-publish is ON.'); };
    $('#yt-priv').onchange = (ev) => save({ youtubePrivacy: ev.target.value }, `Visibility: ${ev.target.value}.`);
    root.querySelectorAll('[data-save]').forEach((b) => (b.onclick = async () => {
      const id = b.dataset.save, input = root.querySelector(`[data-when="${id}"]`), n = root.querySelector(`[data-note="${id}"]`);
      if (!input.value) { n.className = 'au-note au-bad'; n.textContent = 'Pick a date and time.'; return; }
      b.disabled = true; b.textContent = 'Saving…';
      try { const r = await api('/api/automation/youtube/schedule', { method: 'POST', body: { runId: id, publishAt: fromIst(input.value) } }); n.className = 'au-note au-good'; n.textContent = `Saved (${r.youtube}).`; setTimeout(load, 1200); }
      catch (e) { n.className = 'au-note au-bad'; n.textContent = e.message; b.disabled = false; b.textContent = 'Save'; }
    }));
    $('#yt-refresh').onclick = (ev) => { ev.target.disabled = true; ev.target.textContent = 'Refreshing…'; load(); };
  }

  async function load() {
    try { data = await api('/api/automation/youtube/videos'); paint(); }
    catch (e) { if (root) root.innerHTML = `<p class="au-bad">Could not load YouTube status: ${esc(e.message)}</p>`; }
  }

  function show() { root = $('#youtube-root'); if (!root) return; root.innerHTML = '<p class="muted">Loading…</p>'; load(); }
  window.YouTubeUI = { show };
})();
