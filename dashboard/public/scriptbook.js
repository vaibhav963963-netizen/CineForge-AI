// Script Book: add topics for automation (one or many, one per line), see each topic's live status, edit or delete
// topics that are still waiting. A topic is used once: when automation picks it, it leaves the queue for good.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '–');
  let root = null, history = [], queue = [], runs = [];

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((typeof j.error === 'string' ? j.error : j.error?.message) || r.statusText);
    return j;
  }
  const parseTopics = (text) => String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim()).filter(Boolean);
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  // live status of a topic, from the automation run that used it
  function statusOf(h) {
    const run = runs.find((r) => r.topic && same(r.topic, h.topic));
    if (run) {
      if (run.status === 'published') return ['Published', 'au-good', run.youtube_url];
      if (run.youtube_video_id) return [run.publish_at && Date.parse(run.publish_at) > Date.now() ? `Scheduled · ${when(run.publish_at)}` : 'Uploaded', 'au-good', run.youtube_url];
      if (run.status === 'dead') return ['Failed', 'au-bad', null];
      return [`In progress (${run.stage})`, 'au-warn', null];
    }
    if (queue.some((q) => same(q, h.topic))) return ['Waiting', 'muted', null];
    return ['Used', 'muted', null];
  }
  const isWaiting = (h) => statusOf(h)[0] === 'Waiting';

  function shell() {
    return `<div class="panel" id="sb-budget-panel" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:10px 16px; background:rgba(255,255,255,0.03); border-radius:6px;">
      <div>
        <strong>Groq Daily Token Budget:</strong> <span id="sb-budget-text">Loading…</span>
      </div>
      <div id="sb-queue-status"></div>
    </div>
    <div class="panel">
      <form id="sb-add" class="au-form" style="grid-template-columns: 1fr auto; align-items: end;">
        <label class="au-wide">Topics — one per line (paste a whole list)<textarea id="sb-topics" rows="5" placeholder="SpaceX Starship – The Giant Rocket Catch&#10;Voyager 1 – Humanity's Most Distant Spacecraft"></textarea></label>
        <button class="btn btn-primary btn-sm" id="sb-add-btn" type="submit">Add topics</button>
        <div class="au-wide"><span id="sb-note" class="au-note"></span></div>
      </form>
    </div>
    <div class="panel"><div id="sb-list"></div></div>`;
  }

  function paint() {
    if (!root) return;
    const rows = [...history].reverse();
    $('#sb-list').innerHTML = rows.length
      ? `<table class="jobs-table"><thead><tr><th>#</th><th>Topic</th><th>Added</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((h, i) => {
          const [st, cls, link] = statusOf(h), idx = history.indexOf(h);
          return `<tr><td>${rows.length - i}</td><td>${esc(h.topic)}</td><td>${esc(when(h.addedAt))}</td>
            <td><span class="${cls}">${esc(st)}</span>${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">Open</a>` : ''}</td>
            <td>${isWaiting(h) ? `<button class="btn btn-secondary btn-sm" data-edit="${idx}">Edit</button> <button class="btn btn-danger btn-sm" data-del="${idx}">Delete</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table>`
      : '<p class="muted">No topics added yet.</p>';
    root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => edit(+b.dataset.edit)));
    root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => del(+b.dataset.del)));
  }

  async function load() {
    try {
      const d = await api('/api/automation');
      queue = (d.settings.topicQueue || []).map(String);
      history = (d.settings.topicHistory || []).slice();
      runs = d.runs || [];
      for (const t of queue) if (!history.some((h) => same(h.topic, t))) history.push({ topic: t, addedAt: new Date().toISOString(), status: 'waiting' });
      paint();

      try {
        const sbData = await api('/api/scriptbook');
        const b = sbData.budget || {};
        const q = sbData.queue || {};
        const bEl = $('#sb-budget-text');
        const qEl = $('#sb-queue-status');
        if (bEl) {
          if (b.dailyLimit) {
            const rem = b.dailyRemaining ?? Math.max(0, b.dailyLimit - (b.dailyUsed || 0));
            bEl.textContent = `${rem.toLocaleString()} / ${b.dailyLimit.toLocaleString()} tokens remaining`;
          } else if (b.remaining != null) {
            bEl.textContent = `${b.remaining.toLocaleString()} TPM tokens remaining`;
          } else {
            bEl.textContent = 'Active (ready)';
          }
        }
        if (qEl) {
          if (q.paused) {
            const mins = Math.ceil((q.remainingMs || 0) / 60000);
            qEl.innerHTML = `<span class="au-warn">Queue Paused (resumes in ~${mins} min)</span>`;
          } else {
            qEl.innerHTML = `<span class="au-good">Queue Active</span>`;
          }
        }
      } catch {}
    } catch (e) { $('#sb-list').innerHTML = `<p class="au-bad">Could not load topics: ${esc(e.message)}</p>`; }
  }

  const note = (msg, bad) => { const n = $('#sb-note'); if (n) { n.className = `au-note ${bad ? 'au-bad' : 'au-good'}`; n.textContent = msg; } };
  const save = (q, h) => api('/api/automation/settings', { method: 'POST', body: { settings: { topicQueue: q, topicHistory: h } } });

  async function add(ev) {
    ev.preventDefault();
    const box = $('#sb-topics'), btn = $('#sb-add-btn');
    const parsed = parseTopics(box.value);
    if (!parsed.length) return note('Type or paste at least one topic.', true);
    const known = new Set(history.map((h) => h.topic.toLowerCase())), fresh = [], skipped = [];
    for (const t of parsed) { const k = t.toLowerCase(); if (known.has(k)) skipped.push(t); else { known.add(k); fresh.push(t); } }
    if (!fresh.length) return note(`Nothing added: all ${skipped.length} topic(s) were already in the list.`, true);
    btn.disabled = true; btn.textContent = `Adding ${fresh.length}…`;
    try {
      const now = new Date().toISOString();
      await save([...queue, ...fresh], [...history, ...fresh.map((topic) => ({ topic, addedAt: now, status: 'waiting' }))]);
      box.value = '';
      note(`Added ${fresh.length} topic${fresh.length === 1 ? '' : 's'}${skipped.length ? `; skipped ${skipped.length} already in the list` : ''}.`);
      await load();
    } catch (e) { note(e.message, true); }
    finally { btn.disabled = false; btn.textContent = 'Add topics'; }
  }

  async function edit(i) {
    const h = history[i];
    const next = (prompt('Edit topic', h.topic) || '').trim();
    if (!next || next === h.topic) return;
    if (history.some((x, k) => k !== i && same(x.topic, next))) return note('That topic is already in the list.', true);
    try {
      await save(queue.map((q) => (same(q, h.topic) ? next : q)), history.map((x, k) => (k === i ? { ...x, topic: next } : x)));
      note(`Updated: ${next}`); await load();
    } catch (e) { note(e.message, true); }
  }

  async function del(i) {
    const h = history[i];
    if (!confirm(`Delete "${h.topic}"?`)) return;
    try {
      await save(queue.filter((q) => !same(q, h.topic)), history.filter((_, k) => k !== i));
      note(`Deleted: ${h.topic}`); await load();
    } catch (e) { note(e.message, true); }
  }

  function show() {
    root = $('#scriptbook-root');
    if (!root) return;
    root.innerHTML = shell();
    $('#sb-add').onsubmit = add;
    load();
  }
  window.ScriptBookUI = { show };
})();
