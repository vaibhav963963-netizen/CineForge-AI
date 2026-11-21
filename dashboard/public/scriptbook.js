// Script Book screen: topics → scripts written online → saved → approved → used for offline video production.
// Built with the studio's own components (section-intro, panel, form-group, jobs-table). The form and the toolbar are
// rendered ONCE; the 8-second refresh only updates the status bar and the list, so typing is never lost.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LABEL = { pending: 'Pending', generating: 'Generating', generated: 'Generated', needs_review: 'Needs Review', approved: 'Approved', used: 'Used', failed: 'Failed' };
  const DURATIONS = [20, 30, 45, 60, 75, 90];
  let cat = null, timer = null, built = false, filter = 'all', q = '', fLang = '', fDur = '', last = null;

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((typeof j.error === 'string' ? j.error : j.error?.message) || r.statusText), { data: j });
    return j;
  }
  const flash = (msg, bad) => { const el = $('#sb-flash'); if (!el) return; el.textContent = msg; el.className = `au-flash ${bad ? 'bad' : 'good'}`; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 9000); };
  const voicesFor = (langId) => { const L = cat.languages.find((l) => l.id === langId); return cat.voices.filter((v) => (L?.voiceLangs || []).some((x) => v.language.startsWith(x))); };
  const persFor = (langId) => cat.personalities.filter((p) => p.languages === '*' || (Array.isArray(p.languages) && p.languages.includes(langId)));
  const langName = (id) => cat.languages.find((l) => l.id === id)?.name.split(' (')[0] || id;
  const opts = (list, val, label) => list.map((x) => `<option value="${esc(x.id)}" ${x.id === val ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
  const voiceLabel = (v) => `${v.name} · ${v.gender || ''} ${v.accent || v.language}`.replace(/\s+/g, ' ');

  // ── static shell (built once) ──────────────────────────────────────────────────────────────────────────────────
  function shell() {
    const lang = cat.languages[0].id;
    return `<div class="section-intro"><h2>Script Book</h2><p>Write scripts while you are online, keep them here, and turn approved scripts into videos at any time — video production runs entirely on this computer, even without internet.</p></div>
    <div class="au-flash" id="sb-flash" hidden></div>
    <div class="panel sb-status" id="sb-status"><span class="muted">Checking script writing…</span></div>
    <div class="panel">
      <div class="panel-header"><div><h3>Add a topic</h3><p>Each topic becomes its own script with these settings. Imports from your automation topic queue or Topic Ideas use the same settings.</p></div></div>
      <div class="form-group"><label for="sb-topic">Topic or question</label><input type="text" id="sb-topic" maxlength="220" placeholder="e.g. Why do octopuses have three hearts?"></div>
      <div class="sb-row4">
        <div class="form-group"><label for="sb-lang">Language</label><select id="sb-lang">${opts(cat.languages, lang, (l) => l.name)}</select></div>
        <div class="form-group"><label for="sb-dur">Duration</label><select id="sb-dur">${DURATIONS.filter((d) => d >= cat.duration.min && d <= cat.duration.max).map((d) => `<option value="${d}" ${d === 45 ? 'selected' : ''}>${d} seconds</option>`).join('')}</select></div>
        <div class="form-group"><label for="sb-pers">Personality</label><select id="sb-pers">${opts(persFor(lang), null, (p) => p.name)}</select></div>
        <div class="form-group"><label for="sb-voice">Voice</label><select id="sb-voice">${opts(voicesFor(lang), null, voiceLabel)}</select></div>
      </div>
      <div class="sb-actions-row"><button class="btn btn-primary" id="sb-add">Add topic</button><button class="btn btn-secondary" id="sb-import-queue">Import automation topic queue</button><button class="btn btn-secondary" id="sb-import-ideas">Import Topic Ideas</button></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div><h3>Scripts</h3><p>Only scripts that pass every required check can be approved. Approved scripts can be made into videos offline.</p></div><button class="btn btn-primary" id="sb-gen-pending" disabled>Generate pending</button></div>
      <div class="sb-toolbar"><input type="text" id="sb-q" placeholder="Search topics"><select id="sb-flang"><option value="">All languages</option>${opts(cat.languages, '', (l) => l.name.split(' (')[0])}</select><select id="sb-fdur"><option value="">All durations</option>${DURATIONS.map((d) => `<option value="${d}">${d} s</option>`).join('')}</select></div>
      <div class="sb-filters" id="sb-filters"></div>
      <div id="sb-list"><p class="muted">Loading…</p></div>
    </div>`;
  }
  function bindShell() {
    const langSel = $('#sb-lang');
    langSel.onchange = () => { $('#sb-pers').innerHTML = opts(persFor(langSel.value), null, (p) => p.name); $('#sb-voice').innerHTML = opts(voicesFor(langSel.value), null, voiceLabel); };
    $('#sb-topic').onkeydown = (e) => { if (e.key === 'Enter') $('#sb-add').click(); };
    $('#sb-q').oninput = (e) => { q = e.target.value; paint(); };
    $('#sb-flang').onchange = (e) => { fLang = e.target.value; paint(); };
    $('#sb-fdur').onchange = (e) => { fDur = e.target.value; paint(); };
  }

  // ── dynamic parts (refreshed) ──────────────────────────────────────────────────────────────────────────────────
  function statusBar(st) {
    const on = st.online.ok;
    return `<div class="sb-stat"><span class="au-dot ${on ? 'ok' : 'bad'}"></span><div><b>Script writing</b> <span class="${on ? 'au-good' : 'au-warn'}">${on ? 'online' : 'unavailable'}</span><div class="muted">${esc(st.providerName || st.provider)} · ${esc(st.model)}${on ? '' : ` — ${esc(st.online.reason)}`}</div></div></div>
      <div class="sb-stat"><span class="au-dot ok"></span><div><b>Video production</b> <span class="au-good">works offline</span><div class="muted">Kokoro · Whisper · ComfyUI · 3D · FFmpeg — all on this computer</div></div></div>`;
  }
  const row = (e) => {
    const a = [];
    if (['pending', 'failed', 'needs_review'].includes(e.status)) a.push(`<button class="btn btn-secondary btn-sm" data-sb="generate" data-id="${e.id}">${e.status === 'pending' ? 'Generate' : 'Generate again'}</button>`);
    if (e.projectId && e.version) a.push(`<button class="btn btn-secondary btn-sm" data-openscript="${esc(e.projectId)}">Open</button>`);
    if (['generated', 'needs_review'].includes(e.status) && e.version) a.push(`<button class="btn btn-secondary btn-sm" data-sb="refresh" data-id="${e.id}" title="Re-read the checks of the latest version after editing it in Script Studio">Refresh checks</button>`);
    if (e.status === 'generated') a.push(`<button class="btn btn-primary btn-sm" data-sb="approve" data-id="${e.id}">Approve</button>`);
    if (['approved', 'used'].includes(e.status)) a.push(`<button class="btn btn-primary btn-sm" data-sb="render" data-id="${e.id}">Make video</button>`);
    if (!['approved', 'used', 'generating'].includes(e.status)) a.push(`<button class="btn btn-danger btn-sm" data-sb-del="${e.id}" title="Remove from the book (saved script versions stay in the project)">Remove</button>`);
    const versions = e.versions || [];
    const hist = versions.length || e.approvals?.length ? `<details class="sb-hist"><summary>${versions.length} version${versions.length === 1 ? '' : 's'}${e.approvedVersion ? ` · approved v${e.approvedVersion}` : ''}</summary>${versions.map((v) => `<div>v${v.version}${v.source ? ` · ${esc(v.source)}` : ''}${v.version === e.approvedVersion ? ' · <b>approved</b>' : ''}</div>`).join('')}${(e.approvals || []).map((x) => `<div class="muted">approved v${x.version} · ${new Date(x.at).toLocaleString()}</div>`).join('')}${(e.uses || []).map((u) => `<div class="muted">video ${esc(u.jobId)} · ${new Date(u.at).toLocaleString()}</div>`).join('')}</details>` : '';
    return `<tr>
      <td><div class="sb-topic-title">${esc(e.topic)}</div><div class="muted">${esc(langName(e.language))} · ${e.durationSeconds} s · ${esc(e.personality)} · ${esc(e.voice)}${e.source && e.source !== 'manual' ? ` · from ${esc(e.source)}` : ''}</div>${e.error ? `<div class="sb-err">${esc(e.error)}</div>` : ''}${hist}</td>
      <td><span class="sb-st sb-${e.status}">${LABEL[e.status] || e.status}</span>${e.queued && e.status === 'pending' ? '<div class="muted">queued</div>' : ''}${e.scriptStatus ? `<div class="muted">checks: ${esc(e.scriptStatus)}</div>` : ''}</td>
      <td><div class="sb-actions">${a.join('')}</div></td></tr>`;
  };
  function paint() {
    if (!last) return;
    const { book } = last;
    const counts = Object.fromEntries(book.statuses.map((s) => [s, book.entries.filter((e) => e.status === s).length]));
    $('#sb-filters').innerHTML = ['all', ...book.statuses].map((s) => `<button class="sb-chip ${filter === s ? 'on' : ''}" data-sb-filter="${s}">${s === 'all' ? 'All' : LABEL[s]} <span>${s === 'all' ? book.entries.length : counts[s]}</span></button>`).join('');
    const list = book.entries.filter((e) => (filter === 'all' || e.status === filter) && (!fLang || e.language === fLang) && (!fDur || String(e.durationSeconds) === fDur) && (!q || e.topic.toLowerCase().includes(q.toLowerCase()))).sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));
    $('#sb-list').innerHTML = list.length
      ? `<table class="jobs-table sb-table"><thead><tr><th>Topic</th><th>Status</th><th class="sb-actions-h">Actions</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>`
      : `<div class="empty-state">${book.entries.length ? 'No scripts match these filters.' : 'No topics yet — add one above.'}</div>`;
    const btn = $('#sb-gen-pending'); btn.disabled = !(last.st.online.ok && counts.pending); btn.textContent = `Generate pending (${counts.pending})`;
  }
  async function refresh() {
    try {
      const [book, st] = await Promise.all([api('/api/scriptbook'), api('/api/scriptbook/status')]);
      last = { book, st }; $('#sb-status').innerHTML = statusBar(st); paint();
    } catch (e) { const l = $('#sb-list'); if (l) l.innerHTML = `<div class="empty-state">Script Book could not load: ${esc(e.message)}</div>`; }
  }
  async function show() {
    const root = $('#scriptbook-root'); if (!root) return;
    try { cat ||= await api('/api/catalog'); } catch (e) { root.innerHTML = `<div class="empty-state">Could not load the catalog: ${esc(e.message)}</div>`; return; }
    if (!built) { root.innerHTML = shell(); bindShell(); built = true; }
    await refresh();
    clearInterval(timer); timer = setInterval(() => { if (document.querySelector('#screen-scriptbook.active')) refresh(); }, 8000);
  }

  const sel = () => ({ language: $('#sb-lang').value, durationSeconds: +$('#sb-dur').value, personality: $('#sb-pers').value, voice: $('#sb-voice').value });
  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('#scriptbook-root button'); if (!t || t.dataset.openscript) return;   // "Open" is handled by the app (Script Studio)
    try {
      if (t.id === 'sb-add') { const topic = $('#sb-topic').value.trim(); if (!topic) return flash('Enter a topic first', true); if (!sel().voice) return flash('Choose a voice', true); const r = await api('/api/scriptbook/topics', { method: 'POST', body: { items: [{ topic, ...sel() }] } }); if (r.added.length) $('#sb-topic').value = ''; flash(r.added.length ? 'Topic added — Pending' : 'This topic is already in the book with the same settings', !r.added.length); }
      else if (t.id === 'sb-import-queue' || t.id === 'sb-import-ideas') { const ex = await api('/api/scriptbook/existing-topics'); const topics = t.id === 'sb-import-queue' ? ex.automationQueue : ex.topicIdeas.map((x) => x.topic); if (!topics.length) return flash('No topics found there', true); const r = await api('/api/scriptbook/topics', { method: 'POST', body: { source: t.id === 'sb-import-queue' ? 'automation queue' : 'topic ideas', items: topics.map((topic) => ({ topic, ...sel() })) } }); flash(`${r.added.length} topic(s) imported as Pending${r.added.length < topics.length ? ` (${topics.length - r.added.length} already in the book)` : ''}`); }
      else if (t.id === 'sb-gen-pending') { const r = await api('/api/scriptbook/generate-pending', { method: 'POST' }); flash(`${r.queued} script(s) queued — written one at a time`); }
      else if (t.dataset.sbFilter) { filter = t.dataset.sbFilter; paint(); return; }
      else if (t.dataset.sbDel) { if (!confirm('Remove this topic from the Script Book? Its saved script versions stay in the project.')) return; await api(`/api/scriptbook/${t.dataset.sbDel}`, { method: 'DELETE' }); flash('Removed'); }
      else if (t.dataset.sb) { t.disabled = true; const r = await api(`/api/scriptbook/${t.dataset.id}/${t.dataset.sb}`, { method: 'POST', body: {} }); flash(t.dataset.sb === 'render' ? `Video started (${r.jobId}) — runs fully offline; see Job History` : t.dataset.sb === 'approve' ? 'Approved' : t.dataset.sb === 'generate' ? (r.deduplicated ? 'Already being written' : 'Writing the script (online)…') : 'Checks refreshed'); }
      else return;
    } catch (e) { flash(e.message, true); }
    refresh();
  });
  window.ScriptBookUI = { show };
})();
