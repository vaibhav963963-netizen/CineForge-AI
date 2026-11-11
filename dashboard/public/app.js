// AI SHORTS STUDIO — dashboard controller.
// Options come from /api/catalog (what is really installed); the backend validates every selection; progress comes
// only from the backend job (SSE, with polling fallback) and the bar never shows more than the backend reported.
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const S = { catalog: null, system: null, projects: [], trends: [], preview: null, script: null, job: null, es: null, poll: null, shown: 0, target: 0, raf: null, submitting: false, validateTimer: null, lastValid: null };

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; e.data = j; throw e; }
  return j;
}

// ── navigation ────────────────────────────────────────────────────────────────────────────────────────────
const TITLES = { dashboard: ['Studio Dashboard', 'Overview of your local Shorts pipeline'], create: ['Create a Short', 'Validated options → script → narration → storyboard → scenes → MP4'], scripts: ['Script Studio', 'Review, edit and approve the exact script that will be rendered'], trends: ['Topic Ideas', 'Starting points with supported options'], characters: ['Characters', 'Registered lead characters'], voices: ['Voices', 'Installed Kokoro voices by language'], library: ['Video Library', 'Exported videos and the settings used to make them'], jobs: ['Job History', 'Every job, with real stage timings'], settings: ['Engines & Paths', 'What is installed and where the studio reads and writes'] };
function go(id) {
  if (!TITLES[id]) id = 'dashboard';
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.screen === id));
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${id}`));
  $('#screen-title').textContent = TITLES[id][0]; $('#screen-subtitle').textContent = TITLES[id][1];
  if (id === 'jobs') renderJobHistory(); if (id === 'library') refreshProjects();
}

// ── form ──────────────────────────────────────────────────────────────────────────────────────────────────
function formInput() {
  return { topic: $('#f-topic').value, language: $('#f-language').value, personality: $('#f-personality').value, voice: $('#f-voice').value, style: $('#f-style').value, character: $('#f-character').value, durationSeconds: +$('#f-duration').value, visualMode: $('#f-visualmode').value };
}
const fingerprintOf = (i) => [i.topic.trim().replace(/\s+/g, ' ').toLowerCase(), i.language, i.personality, i.durationSeconds].join('|');

function fillForm() {
  const c = S.catalog;
  $('#f-language').innerHTML = c.languages.map((l) => `<option value="${l.id}" ${l.available ? '' : 'disabled'} title="${esc(l.available ? '' : l.problems.join('; '))}">${esc(l.name)}${l.available ? '' : ' (unavailable)'}</option>`).join('');
  $('#f-style').innerHTML = c.styles.map((s) => `<option value="${s.id}" ${s.available ? '' : 'disabled'}>${esc(s.name)} · ${s.dimension.toUpperCase()}</option>`).join('');
  $('#f-character').innerHTML = c.characters.map((ch) => `<option value="${ch.id}" ${ch.available ? '' : 'disabled'} title="${esc(ch.reason || '')}">${esc(ch.name)}${ch.title && ch.id !== 'none' ? ' — ' + esc(ch.title) : ''}</option>`).join('');
  $('#f-visualmode').innerHTML = c.visualModes.map((m) => `<option value="${m.id}" ${m.available ? '' : 'disabled'} title="${esc(m.reason || '')}">${esc(m.name)}${m.available ? '' : ' — unavailable: ' + esc(m.reason)}</option>`).join('');
  const d = $('#f-duration'); d.min = Math.max(20, c.duration.min); d.max = Math.min(60, c.duration.max);
  const saved = store.get('studio.form');
  if (saved) for (const [k, id] of [['topic', 'f-topic'], ['language', 'f-language'], ['style', 'f-style'], ['character', 'f-character'], ['visualMode', 'f-visualmode'], ['durationSeconds', 'f-duration']]) { const el = $('#' + id); if (saved[k] !== undefined && [...(el.options || [{ value: saved[k] }])].some((o) => o.value == saved[k] && !o.disabled)) el.value = saved[k]; }
  if (!saved || !c.visualModes.find((m) => m.id === $('#f-visualmode').value)?.available) $('#f-visualmode').value = c.visualModes.find((m) => m.available).id;
  if (!saved?.language || !c.languages.find((l) => l.id === $('#f-language').value)?.available) $('#f-language').value = c.languages.find((l) => l.available)?.id;
  onLanguageChange(saved);
}

function onLanguageChange(saved) {
  const c = S.catalog, lang = c.languages.find((l) => l.id === $('#f-language').value);
  const pv = saved?.personality || $('#f-personality').value, vv = saved?.voice || $('#f-voice').value;
  $('#f-personality').innerHTML = c.personalities.map((p) => { const ok = lang && p.languageCodes.includes(lang.code); return `<option value="${p.id}" ${ok ? '' : 'disabled'} title="${esc(ok ? p.blurb : `Requires ${p.languageCodes.map((x) => (x === 'hi' ? 'Hindi/Hinglish' : 'English')).join(' or ')}`)}">${esc(p.name)}${ok ? '' : ' (needs Hindi)'}</option>`; }).join('');
  const pOk = [...$('#f-personality').options].find((o) => o.value === pv && !o.disabled); $('#f-personality').value = pOk ? pv : [...$('#f-personality').options].find((o) => !o.disabled).value;
  const voices = c.voices.filter((v) => lang && lang.voices.includes(v.id)).sort((a, b) => (b.recommended - a.recommended) || a.id.localeCompare(b.id));
  const groups = {}; voices.forEach((v) => (groups[v.accent] = groups[v.accent] || []).push(v));
  $('#f-voice').innerHTML = Object.entries(groups).map(([g, vs]) => `<optgroup label="${esc(g)}">${vs.map((v) => `<option value="${v.id}">${esc(v.name)} · ${v.gender} · ${esc(v.notes)}${v.recommended ? ' ★' : ''} (${v.id})</option>`).join('')}</optgroup>`).join('');
  if (voices.some((v) => v.id === vv)) $('#f-voice').value = vv;
  onFormChange();
}

function onFormChange() {
  const i = formInput(); store.set('studio.form', i);
  $('#duration-val').textContent = `${i.durationSeconds}s`;
  $('#duration-hint').textContent = `Final video must be ${(i.durationSeconds * (1 - S.catalog.duration.tolerance)).toFixed(0)}–${(i.durationSeconds * (1 + S.catalog.duration.tolerance)).toFixed(0)} s (±${Math.round(S.catalog.duration.tolerance * 100)}%)`;
  const st = S.catalog.styles.find((s) => s.id === i.style); $('#style-hint').textContent = st ? st.summary : '';
  const ch = S.catalog.characters.find((c) => c.id === i.character);
  $('#character-hint').textContent = i.character === 'none' ? 'Scenes use places, objects and generic people only.' : st && st.dimension === '2d' ? `${st.name} is 2D: ${ch?.name} appears as a 2D figure in the registered colours.` : `${ch?.name} appears as the registered 3D model where it fits the story.`;
  renderPreviewState();
  clearTimeout(S.validateTimer); S.validateTimer = setTimeout(validateNow, 250);
}

async function validateNow() {
  const i = formInput(), fe = $('#form-errors');
  $$('.form-group').forEach((g) => { g.classList.remove('has-error'); const e = g.querySelector('.field-error'); if (e) e.textContent = ''; });
  const scriptVersion = previewIsFresh() ? S.preview.version : null;
  let v; try { v = await api('/api/validate', { method: 'POST', body: { input: i, purpose: 'render', scriptVersion } }); } catch (e) { v = e.data || { ok: false, errors: [{ field: 'engine', message: e.message }] }; }
  S.lastValid = v;
  const other = [];
  for (const e of v.errors || []) {
    const g = document.querySelector(`.form-group[data-field="${e.field}"]`);
    if (g && e.field !== 'topic' || (g && i.topic)) { g.classList.add('has-error'); g.querySelector('.field-error').textContent = e.message + (e.alternatives ? ` Supported: ${e.alternatives.join(', ')}` : ''); }
    else if (!g) other.push(e.message);
  }
  fe.hidden = !other.length; fe.innerHTML = other.map((m) => `<div>⚠ ${esc(m)}</div>`).join('');
  if (v.ok) {
    const c = v.config;
    $('#config-summary').innerHTML = `<div class="cfg-grid">
      <span>Language</span><b>${esc(c.language.name)} <code>${c.language.code}-${c.language.script}</code></b>
      <span>Narration</span><b>${esc(c.narration.personalityName)} · ${esc(c.narration.voiceName)} · speed ${c.narration.speed} · <code>${c.narration.ttsLang}</code></b>
      <span>Visuals</span><b>${esc(c.visual.styleName)} (${c.visual.dimension}) · ${esc(c.visual.characterName)} · ${c.visual.visualMode}</b>
      <span>Output</span><b>${c.durationSeconds} s ±${Math.round(c.durationTolerance * 100)}% · ${c.resolution} · ${c.fps} fps</b>
      <span>Alignment</span><b>${esc(c.alignment.model)}</b></div>${(v.warnings || []).map((w) => `<div class="cfg-warn">ℹ ${esc(w)}</div>`).join('')}`;
  } else {
    const msg = !i.topic.trim() ? 'Enter a topic to resolve the configuration.' : (v.errors || []).some((e) => document.querySelector(`.form-group[data-field="${e.field}"]`)) ? 'Fix the highlighted options to see the final configuration.' : 'Options are valid, but generation is blocked — see the message below.';
    $('#config-summary').innerHTML = `<span class="muted">${msg}</span>`;
  }
  updateButtons();
}

function previewIsFresh() { return !!(S.preview && S.preview.fingerprint === fingerprintOf(formInput())); }
function renderPreviewState() {
  const el = $('#preview-state');
  if (!S.preview) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'preview-state ' + (previewIsFresh() ? 'fresh' : 'stale');
  el.innerHTML = previewIsFresh()
    ? `✔ Approved script <b>v${S.preview.version}</b> (${esc(S.preview.projectId)}) will be rendered exactly as previewed. <a href="#" data-goto="scripts">Open in Script Studio</a>`
    : `⚠ Topic, language, personality or duration changed after script <b>v${S.preview.version}</b> was generated. It no longer matches — generate a new preview, or render to let the studio write a new script.`;
}
function updateButtons() {
  const busy = S.submitting || (S.job && ['running', 'queued'].includes(S.job.status));
  const ok = S.lastValid && S.lastValid.ok;
  $('#btn-render').disabled = busy || !ok;
  $('#btn-manual').disabled = busy || !formInput().topic.trim() || (S.lastValid?.errors || []).some((e) => e.field !== 'script');
  const llm = S.catalog?.engines.llm.ready;
  $('#btn-preview').disabled = busy || !formInput().topic.trim() || !llm;
  $('#btn-preview').title = llm ? '' : `Local script model unavailable: ${S.catalog?.engines.llm.reason}`;
  $('#btn-render').querySelector('span').textContent = previewIsFresh() ? `Render approved script v${S.preview.version}` : 'Generate Complete MP4 Video';
  $('#btn-approve-render').disabled = busy || !S.script;
  $('#btn-regenerate').disabled = busy || !S.script || !llm;
  $('#nav-job-badge').hidden = !busy;
}

// ── jobs ──────────────────────────────────────────────────────────────────────────────────────────────────
async function submit(kind) {
  if (S.submitting) return;
  const input = formInput();
  let body = { input, requestKey: uid() }, url = '/api/jobs';
  if (kind === 'preview') { url = '/api/scripts/preview'; if (S.preview) body.projectId = S.preview.projectId; }
  else if (S.preview) {
    if (previewIsFresh()) Object.assign(body, { projectId: S.preview.projectId, scriptVersion: S.preview.version });
    else if (!confirm(`Your selection changed after script v${S.preview.version} was previewed.\n\nRender anyway with a NEW script written for the current selection?`)) return;
  }
  S.submitting = true; updateButtons();
  try {
    const r = await api(url, { method: 'POST', body });
    if (r.deduplicated) toast('That job is already running — showing its progress.');
    attachJob(r.jobId);
  } catch (e) {
    const errs = e.data?.errors?.map((x) => x.message) || [e.message];
    $('#form-errors').hidden = false; $('#form-errors').innerHTML = errs.map((m) => `<div>✖ ${esc(m)}</div>`).join('');
  } finally { S.submitting = false; updateButtons(); }
}

function attachJob(jobId) {
  detachJob(); store.set('studio.activeJob', jobId);
  $('#job-panel').hidden = false; S.shown = 0; S.target = 0; $('#job-log').innerHTML = '';
  if (!$('#screen-create').classList.contains('active')) go('create');
  const startPolling = () => {
    $('#job-transport').textContent = 'live: polling';
    const tick = async () => { try { const j = await api(`/api/jobs/${jobId}`); onJob(j); if (['completed', 'failed', 'cancelled'].includes(j.status)) return; } catch {} S.poll = setTimeout(tick, 1000); };
    tick();
  };
  if ('EventSource' in window) {
    const es = new EventSource(`/api/jobs/${jobId}/events`); S.es = es; $('#job-transport').textContent = 'live: SSE';
    es.addEventListener('progress', (e) => onJob(JSON.parse(e.data)));
    es.addEventListener('end', () => { es.close(); S.es = null; });
    es.onerror = () => { if (S.es === es) { es.close(); S.es = null; if (!S.job || !['completed', 'failed', 'cancelled'].includes(S.job.status)) startPolling(); } };
  } else startPolling();
}
function detachJob() { if (S.es) { S.es.close(); S.es = null; } clearTimeout(S.poll); }

const fmtT = (s) => (s == null ? '–' : s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);
function onJob(j) {
  const was = S.job?.status; S.job = j;
  S.target = j.progress;   // the display animates toward this and never past it
  if (['completed', 'failed', 'cancelled'].includes(j.status)) S.shown = j.progress;   // finished: show the final value as-is
  animateBar();
  $('#job-title').textContent = `${j.kind === 'script' ? 'Script preview' : 'Video render'} · ${j.title}`;
  $('#job-message').textContent = j.message;
  $('#job-pulse').className = 'pulse-indicator ' + j.status;
  $('#job-meta').innerHTML = `<span>Status <b class="st-${j.status}">${j.status}</b></span><span>Stage <b>${esc(j.currentStageName || '–')}</b>${j.stageProgress != null ? ` · ${j.stageProgress}%` : j.status === 'running' ? ' · <i>measuring…</i>' : ''}</span><span>Elapsed <b>${fmtT(j.elapsedSeconds)}</b></span><span>Remaining <b>${j.estimatedRemainingSeconds != null ? '≈' + fmtT(j.estimatedRemainingSeconds) : 'not enough data yet'}</b></span><span>Job <code>${j.jobId}</code></span>`;
  $('#job-stages').innerHTML = j.stages.map((s) => {
    const icon = { done: '✔', running: '●', skipped: '↷', failed: '✖', cancelled: '■', pending: '○' }[s.status] || '○';
    const counter = s.status === 'running' && s.total ? ` <span class="ctr">${s.current ?? 0} / ${s.total}${s.unit ? ' ' + s.unit + 's' : ''}</span>` : '';
    const bar = s.status === 'running' ? (s.fraction == null ? '<div class="stage-bar indet"><div></div></div>' : `<div class="stage-bar"><div style="width:${(s.fraction * 100).toFixed(1)}%"></div></div>`) : '';
    const dur = s.startedAt && s.endedAt ? ` <span class="dur">${((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000).toFixed(1)}s</span>` : '';
    return `<li class="stage ${s.status}"><span class="ic">${icon}</span><div class="sb"><div class="sn">${esc(s.name)}<span class="w">${s.status === 'skipped' ? 'skipped' : s.weight + '%'}</span>${counter}${dur}</div>${s.message && s.status !== 'pending' ? `<div class="sm">${esc(s.message)}</div>` : ''}${bar}</div></li>`;
  }).join('');
  const w = $('#job-warnings'); w.hidden = !j.warnings.length && !j.error;
  w.innerHTML = (j.error ? `<div class="err">✖ ${esc(j.failedStage ? `Failed during ${j.stages.find((s) => s.id === j.failedStage)?.name}: ` : '')}${esc(j.error)}</div>` : '') + j.warnings.map((x) => `<div>⚠ ${esc(x)}</div>`).join('');
  $('#job-log').innerHTML = (j.logs || []).map((l) => `<div class="log-line">${esc(l)}</div>`).join(''); $('#job-log').scrollTop = 1e9;
  $('#btn-cancel').hidden = !['running', 'queued'].includes(j.status);
  $('#btn-retry').hidden = !['failed', 'cancelled'].includes(j.status);
  const res = $('#job-result');
  if (j.status === 'completed' && j.kind === 'render') {
    res.hidden = false;
    res.innerHTML = `<div class="ok">✔ Video verified and exported</div><div>File: <code>${esc(j.result.exportAbsolutePath || j.result.exportPath)}</code></div><div>${j.result.durationSeconds} s (target ${j.result.targetSeconds} s, ${j.result.withinTolerance ? 'within tolerance' : 'OUT of tolerance'}) ·${j.result.width}×${j.result.height} · ${Math.round(j.result.fps)} fps · ${j.result.sizeMB} MB · QA ${esc(j.result.qa)}</div><button class="btn btn-primary btn-sm" id="btn-watch">▶ Preview MP4</button>`;
    $('#btn-watch').onclick = () => openVideo(j.projectId);
  } else if (j.status === 'completed' && j.kind === 'script') {
    res.hidden = false; res.innerHTML = `<div class="ok">✔ Script v${j.result.version} ready · ${j.result.estimate.words} words · ≈${j.result.estimate.seconds} s</div><button class="btn btn-primary btn-sm" data-goto="scripts">Review in Script Studio</button>`;
  } else res.hidden = true;
  if (j.status !== was && ['completed', 'failed', 'cancelled'].includes(j.status)) onJobFinished(j);
  updateButtons();
}
function animateBar() {
  cancelAnimationFrame(S.raf);
  const step = () => {
    const t = S.target;
    if (S.shown > t) S.shown = t;                       // never above the backend value
    else S.shown = Math.min(t, S.shown + Math.max(0.25, (t - S.shown) * 0.12));
    $('#job-fill').style.width = `${S.shown}%`; $('#job-percent').textContent = `${Math.floor(S.shown)}%`;
    $('#job-fill').className = 'progress-fill ' + (S.job?.status || '');
    if (S.shown < t) S.raf = requestAnimationFrame(step);
  };
  S.raf = requestAnimationFrame(step);
}
async function onJobFinished(j) {
  if (j.status === 'completed' && j.kind === 'script') {
    S.preview = { projectId: j.projectId, version: j.result.version, fingerprint: fingerprintOf(formInput()) };
    store.set('studio.preview', S.preview);
    await loadScript(j.projectId, j.result.version); renderPreviewState(); go('scripts');
  }
  if (j.kind === 'render') refreshProjects();
}

// ── script studio ─────────────────────────────────────────────────────────────────────────────────────────
async function loadScript(projectId, version) {
  const [p, s] = await Promise.all([api(`/api/projects/${projectId}`), api(`/api/projects/${projectId}/scripts/${version}`)]);
  S.script = { project: p, version, data: s };
  $('#script-title').textContent = s.title; $('#script-sub').textContent = `${p.id} · v${version} · ${s.meta.source}${s.meta.model ? ' · ' + s.meta.model.name : ''}`;
  const vs = $('#script-version'); vs.hidden = false;
  vs.innerHTML = p.script.versions.map((v) => `<option value="${v.version}" ${v.version === version ? 'selected' : ''}>v${v.version} · ${v.source}${v.approved ? ' · approved' : ''}</option>`).join('');
  const hing = p.config.language.id === 'hinglish';
  $('#script-editor').innerHTML = s.lines.map((l, i) => lineEditor(l, i, hing)).join('');
  $('#script-config-card').innerHTML = `<h4>Written for</h4><p>${esc(p.config.language.name)}<br>${esc(p.config.narration.personalityName)}<br>${p.config.durationSeconds} s target</p>`;
  ['#btn-add-line', '#btn-save-version'].forEach((b) => ($(b).disabled = false));
  updateStats(); updateButtons();
}
const lineEditor = (l, i, hing) => `<div class="line-edit" data-i="${i}"><div class="ln">${i + 1}</div><div class="lf">
  <textarea class="le-text" rows="2" placeholder="Narration text">${esc(l.text)}</textarea>
  ${hing ? `<textarea class="le-say" rows="1" placeholder="Say (Devanagari)">${esc(l.say || '')}</textarea>` : ''}
  <div class="le-row"><input class="le-visual" placeholder="Visual (English): what the viewer sees" value="${esc(l.visual || '')}"><input class="le-onscreen" placeholder="On screen (optional)" value="${esc(l.onScreen || '')}"></div>
  </div><button class="le-del" title="Remove line">×</button></div>`;
function editedLines() { return $$('.line-edit').map((el) => ({ text: el.querySelector('.le-text').value.trim(), say: el.querySelector('.le-say')?.value.trim() || undefined, visual: el.querySelector('.le-visual').value.trim(), onScreen: el.querySelector('.le-onscreen').value.trim() || undefined })).filter((l) => l.text); }
function updateStats() {
  if (!S.script) return;
  const c = S.script.project.config, lines = editedLines(), wps = c.language.code === 'hi' ? 2.2 : 2.6;
  const words = lines.reduce((a, l) => a + (l.say || l.text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length, 0);
  const d = c.narration.delivery, est = words / (wps * c.narration.speed) + d.lead + d.outro + Math.max(0, lines.length - 1) * d.gap * 0.7;
  const tol = c.durationTolerance, ok = Math.abs(est - c.durationSeconds) <= c.durationSeconds * (tol + 0.05);
  $('#script-stats').innerHTML = `<span>${lines.length} lines</span><span>${words} words</span><span class="${ok ? 'good' : 'bad'}">≈${est.toFixed(1)} s estimated (target ${c.durationSeconds} s)</span><span class="muted">Final timing is measured from the real narration; Kokoro speed may be adjusted within the personality's range to fit.</span>`;
}
async function saveVersion(approve) {
  const p = S.script.project, errBox = $('#script-errors');
  try {
    const r = await api(`/api/projects/${p.id}/scripts`, { method: 'POST', body: { title: $('#script-title').textContent, lines: editedLines(), baseVersion: S.script.version, approve } });
    errBox.hidden = true; await loadScript(p.id, r.version);
    S.preview = { projectId: p.id, version: r.version, fingerprint: fingerprintOf(inputFromConfig(p.config)) }; store.set('studio.preview', S.preview);
    return r.version;
  } catch (e) { errBox.hidden = false; errBox.textContent = '✖ ' + e.message; return null; }
}
const inputFromConfig = (c) => ({ topic: c.topic, language: c.language.id, personality: c.narration.personality, voice: c.narration.voice, style: c.visual.style, character: c.visual.character, durationSeconds: c.durationSeconds, visualMode: c.visual.visualMode });
function loadFormFromConfig(c) {
  const i = inputFromConfig(c);
  $('#f-topic').value = i.topic; $('#f-language').value = i.language; onLanguageChange({ personality: i.personality, voice: i.voice });
  $('#f-style').value = i.style; $('#f-character').value = i.character; $('#f-duration').value = i.durationSeconds; $('#f-visualmode').value = i.visualMode; onFormChange();
}

// ── library, history, settings, rosters ────────────────────────────────────────────────────────────────────
async function refreshProjects() { try { S.projects = await api('/api/projects'); } catch { return; } renderLibrary(); renderDashboard(); }
function settingsSummary(p) {
  if (p.legacy) return `<div class="legacy">${esc(p.note)}${p.voiceUsed ? ` Voice used: <code>${esc(p.voiceUsed)}</code>.` : ''}</div>`;
  const c = p.config; if (!c) return '';
  return `<dl class="settings-dl"><dt>Language</dt><dd>${esc(c.language.name)}</dd><dt>Personality</dt><dd>${esc(c.narration.personalityName)}</dd><dt>Voice</dt><dd>${esc(c.narration.voiceName)}${p.voice ? ` · speed ${p.voice.speed}` : ''}</dd><dt>Style</dt><dd>${esc(c.visual.styleName)}</dd><dt>Character</dt><dd>${esc(c.visual.characterName)}</dd><dt>Visual mode</dt><dd>${c.visual.visualMode}</dd><dt>Duration</dt><dd>${p.render?.durationSeconds ? `${p.render.durationSeconds} s actual / ${c.durationSeconds} s target` : `${c.durationSeconds} s target`}</dd><dt>Script</dt><dd>v${p.script?.approvedVersion ?? '–'} of ${p.script?.versions?.length || 0}</dd><dt>Storyboard</dt><dd>${p.storyboard ? `v${p.storyboard.version}, ${p.storyboard.shots} shots` : '–'}</dd><dt>QA</dt><dd>${p.qa?.status || '–'}</dd><dt>Export</dt><dd><code>${esc(p.exportPath || '–')}</code></dd></dl>`;
}
function renderLibrary() {
  $('#nav-video-count').textContent = S.projects.filter((p) => p.hasVideo).length;
  $('#library-grid').innerHTML = S.projects.length ? S.projects.map((p) => `<div class="video-card">
    <div class="video-thumb-container">${p.coverUrl ? `<img src="${p.coverUrl}" class="video-thumb-img" alt="">` : ''}${p.hasVideo ? `<div class="video-play-overlay" data-play="${p.id}"><div class="play-btn-circle">▶</div></div>` : ''}</div>
    <div class="video-info-box"><h4>${esc(p.title)}</h4><div class="video-meta-row"><span class="badge-count">${esc(p.status)}</span><span>${p.legacy ? 'legacy' : esc(p.id)}</span></div>${settingsSummary(p)}
    <div class="form-actions">${p.hasVideo ? `<button class="btn btn-primary btn-sm" data-play="${p.id}">Watch</button>` : ''}${!p.legacy && p.config ? `<button class="btn btn-secondary btn-sm" data-reuse="${p.id}">Reuse settings</button>` : ''}${!p.legacy && p.script?.versions?.length ? `<button class="btn btn-secondary btn-sm" data-openscript="${p.id}">Script</button>` : ''}</div></div></div>`).join('') : '<div class="empty-state">No projects yet.</div>';
}
function renderDashboard() {
  $('#stat-total-videos').textContent = S.projects.filter((p) => p.hasVideo).length; $('#stat-projects').textContent = S.projects.length;
  $('#dashboard-recent-projects').innerHTML = S.projects.slice(0, 5).map((p) => `<div class="project-card"><div class="proj-left">${p.coverUrl ? `<img src="${p.coverUrl}" class="proj-thumb" alt="">` : '<div class="proj-thumb"></div>'}<div class="proj-info"><h4>${esc(p.title)}</h4><div class="proj-meta">${p.legacy ? 'legacy · settings not recorded' : `${esc(p.config?.language.name)} · ${esc(p.config?.visual.styleName)} · ${p.render?.durationSeconds ? p.render.durationSeconds + ' s' : esc(p.status)}`}</div></div></div><div class="proj-right">${p.hasVideo ? `<button class="btn btn-secondary btn-sm" data-play="${p.id}">▶</button>` : `<span class="badge-count">${esc(p.status)}</span>`}</div></div>`).join('') || '<div class="empty-state">No projects yet.</div>';
}
function openVideo(id) {
  const p = S.projects.find((x) => x.id === id), url = p?.videoUrl || `/media/exports/${id}.mp4`;
  $('#modal-title').textContent = p?.title || id; $('#modal-player').src = url; $('#modal-download').href = url; $('#modal-download').setAttribute('download', `${id}.mp4`);
  $('#modal-settings').innerHTML = p ? settingsSummary(p) : ''; $('#video-modal').style.display = 'flex'; $('#modal-player').play().catch(() => {});
}
async function renderJobHistory() {
  const list = await api('/api/jobs?limit=60').catch(() => []);
  $('#job-history').innerHTML = list.length ? `<table class="jobs-table"><thead><tr><th>Job</th><th>Kind</th><th>Project</th><th>Status</th><th>Progress</th><th>Elapsed</th><th>Stages (s)</th></tr></thead><tbody>${list.map((j) => `<tr><td><code>${j.jobId}</code><div class="muted">${new Date(j.createdAt).toLocaleString()}</div></td><td>${j.kind}</td><td>${esc(j.projectId)}</td><td class="st-${j.status}">${j.status}${j.error ? `<div class="muted">${esc(j.error.slice(0, 140))}</div>` : ''}</td><td>${j.progress}%</td><td>${fmtT(j.elapsedSeconds)}</td><td class="stage-times">${j.stages.filter((s) => s.startedAt && s.endedAt).map((s) => `${s.id} ${((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000).toFixed(0)}`).join(' · ')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">No jobs yet.</div>';
}
function renderSettings() {
  const e = S.system.engines, row = (k, v, ok = true) => `<div class="setting-item"><span class="set-label">${esc(k)}</span><span class="set-val ${ok ? 'text-emerald' : 'text-saffron'}">${v}</span></div>`;
  $('#engines-grid').innerHTML = [
    row('Kokoro TTS', e.tts.ready ? `${esc(e.tts.model)} · ${e.tts.voicesInPack} voices in pack` : esc(e.tts.reason), e.tts.ready),
    row('Whisper (English)', esc(e.whisper.english?.name || 'not installed'), !!e.whisper.english),
    row('Whisper (multilingual)', esc(e.whisper.multilingual?.name || 'not installed — Hindi unavailable'), !!e.whisper.multilingual),
    row('Script model (llama.cpp)', e.llm.ready ? `${esc(e.llm.name)}${e.llm.license ? ' · ' + esc(e.llm.license) : ''}` : esc(e.llm.reason), e.llm.ready),
    row('Image generation (ComfyUI)', e.comfyui.ready ? `${esc(e.comfyui.model)}${e.comfyui.license ? ' · ' + esc(e.comfyui.license) : ''}` : esc(e.comfyui.reason), e.comfyui.ready),
    row('Devanagari caption font', e.fonts.devanagari ? esc(e.fonts.devanagari.files.join(', ')) : 'missing', !!e.fonts.devanagari),
    row('Chrome (WebGL capture)', esc(e.chrome.path || 'not found'), e.chrome.ready), row('FFmpeg', e.ffmpeg.ready ? 'runtime/ffmpeg/bin' : 'missing', e.ffmpeg.ready),
  ].join('');
  $('#paths-grid').innerHTML = [row('Workspace', esc(S.system.workspace)), ...Object.entries(S.system.paths).map(([k, v]) => row(k, `<code>${esc(v)}</code>`)), row('Free disk', S.system.disk ? `${S.system.disk.freeGB} GB of ${S.system.disk.totalGB} GB` : '–')].join('');
  const ready = S.catalog.languages.filter((l) => l.available);
  $('#stat-langs').textContent = `${ready.length} / ${S.catalog.languages.length}`; $('#stat-langs-sub').textContent = ready.map((l) => l.id).join(', ');
  $('#stat-comfy').textContent = e.comfyui.ready ? 'Ready' : 'Off'; $('#stat-comfy-sub').textContent = e.comfyui.ready ? e.comfyui.model : e.comfyui.reason;
  $('#disk-free-pill').textContent = S.system.disk ? `${S.system.disk.freeGB} GB free` : '';
  const allOk = e.tts.ready && e.chrome.ready && e.ffmpeg.ready;
  $('#engine-dot').className = 'gpu-indicator ' + (allOk ? 'online' : 'offline'); $('#engine-title').textContent = allOk ? 'Core engines ready' : 'Engine missing';
  $('#engine-sub').textContent = `LLM ${e.llm.ready ? '✓' : '✗'} · ComfyUI ${e.comfyui.ready ? '✓' : '✗'} · Hindi ${e.whisper.multilingual ? '✓' : '✗'}`;
}
function portrait(c) {
  const skin = c.skin || '#E8B89A', acc = c.accentColor || '#1E88E5', hair = c.hairColor || '#222';
  return `<svg viewBox="0 0 220 220" width="100%" height="100%"><defs><radialGradient id="g_${c.id}" cx="50%" cy="40%" r="65%"><stop offset="0%" stop-color="${acc}" stop-opacity="0.35"/><stop offset="100%" stop-color="#0E1218"/></radialGradient></defs><rect width="220" height="220" fill="url(#g_${c.id})"/><path d="M55 170 Q110 152 165 170 L180 220 L40 220 Z" fill="${acc}"/><rect x="98" y="130" width="24" height="28" fill="${skin}"/><ellipse cx="110" cy="114" rx="30" ry="34" fill="${skin}"/><path d="M80 108 Q80 80 110 80 Q140 80 140 108 Q130 88 110 88 Q90 88 80 108Z" fill="${hair}"/><circle cx="98" cy="113" r="3" fill="#111"/><circle cx="122" cy="113" r="3" fill="#111"/><path d="M101 129 Q110 136 119 129" stroke="#7a2a2a" stroke-width="2.5" fill="none"/></svg>`;
}
function renderRosters() {
  $('#characters-grid').innerHTML = S.catalog.characters.filter((c) => c.id !== 'none').map((c) => `<div class="char-card-3d"><div class="char-stage-3d"><span class="stage-badge">${c.available ? '3D design ✓' : 'no 3D design'}</span>${portrait(c)}</div><div class="char-content-3d"><div class="char-header-3d"><h3>${esc(c.name)}</h3><span class="char-role-badge">${esc(c.title || '')}</span></div><p class="char-desc-3d">${esc(c.role || '')}</p><div class="char-attire-pill"><span class="spec-label">Attire:</span> <span class="attire-text">${esc(c.attire || '')}</span></div><button class="btn btn-secondary btn-sm" data-usechar="${c.id}" ${c.available ? '' : 'disabled'}>Use in a video</button></div></div>`).join('');
  $('#voices-intro').textContent = `${S.catalog.voices.length} voices installed for the studio's languages (read from models/kokoro/voices-v1.0.bin).`;
  const byLang = {}; S.catalog.voices.forEach((v) => (byLang[v.accent] = byLang[v.accent] || []).push(v));
  $('#voices-grid').innerHTML = Object.entries(byLang).map(([g, vs]) => vs.map((v) => `<div class="voice-card"><h3>${esc(v.name)} ${v.recommended ? '★' : ''}</h3><p>${esc(v.notes)}</p><div class="voice-tags"><span class="voice-tag">${esc(g)}</span><span class="voice-tag">${v.gender}</span><span class="voice-tag"><code>${v.id}</code></span></div></div>`).join('')).join('');
  $('#trends-grid').innerHTML = S.trends.map((t) => `<div class="trend-card"><div class="trend-badge-row"><span class="badge-cat">${esc(t.category)}</span><span class="badge-demand high">${esc(t.demand)}</span></div><h3>${esc(t.title)}</h3><div class="trend-hook">"${esc(t.hook)}"</div><div class="trend-meta-row"><span>${esc(S.catalog.languages.find((l) => l.id === t.language)?.name || t.language)}</span> · <span>${esc(S.catalog.styles.find((s) => s.id === t.style)?.name || t.style)}</span> · <span>${t.duration}s</span></div><button class="btn btn-primary btn-sm btn-block" data-usetrend="${t.id}">Use this topic</button></div>`).join('');
  $('#dashboard-trend-mini').innerHTML = S.trends.slice(0, 4).map((t) => `<div class="trend-mini-card" data-usetrend="${t.id}"><div><div class="trend-mini-title">${esc(t.title)}</div><div class="trend-mini-cat">${esc(t.category)} · ${t.duration}s</div></div></div>`).join('');
}
function useTrend(id) {
  const t = S.trends.find((x) => x.id === id); if (!t) return;
  $('#f-topic').value = t.title;
  if (S.catalog.languages.find((l) => l.id === t.language)?.available) $('#f-language').value = t.language;
  onLanguageChange({ personality: t.personality }); $('#f-style').value = t.style; $('#f-duration').value = t.duration; onFormChange(); go('create');
}
let toastT; function toast(m) { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = m; el.className = 'show'; clearTimeout(toastT); toastT = setTimeout(() => (el.className = ''), 3500); }

// ── boot ──────────────────────────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.screen)));
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-goto],[data-play],[data-reuse],[data-openscript],[data-usetrend],[data-usechar],.le-del'); if (!t) return;
    if (t.dataset.goto) { e.preventDefault(); go(t.dataset.goto); }
    if (t.dataset.play) openVideo(t.dataset.play);
    if (t.dataset.usetrend) useTrend(t.dataset.usetrend);
    if (t.dataset.usechar) { $('#f-character').value = t.dataset.usechar; onFormChange(); go('create'); }
    if (t.dataset.reuse) { const p = S.projects.find((x) => x.id === t.dataset.reuse); loadFormFromConfig(p.config); go('create'); }
    if (t.dataset.openscript) { const p = S.projects.find((x) => x.id === t.dataset.openscript); loadScript(p.id, p.script.approvedVersion || p.script.versions.at(-1).version).then(() => go('scripts')); }
    if (t.classList.contains('le-del')) { t.closest('.line-edit').remove(); updateStats(); }
  });
  $('#btn-quick-create').onclick = () => go('create');
  ['#f-topic', '#f-personality', '#f-voice', '#f-style', '#f-character', '#f-visualmode', '#f-duration'].forEach((s) => $(s).addEventListener('input', onFormChange));
  $('#f-language').addEventListener('change', () => onLanguageChange());
  $('#btn-random').onclick = () => { const t = S.trends[Math.floor(Math.random() * S.trends.length)]; if (t) useTrend(t.id); };
  $('#btn-preview').onclick = () => submit('preview');
  $('#btn-manual').onclick = async () => {
    // a project with the validated options and an empty editor; the script is language-checked when saved
    try {
      const { project } = await api('/api/projects', { method: 'POST', body: { input: formInput() } });
      const hing = project.config.language.id === 'hinglish';
      S.script = { project, version: null, data: { title: project.title, lines: [{ text: '' }, { text: '' }, { text: '' }], meta: { source: 'manual' } } };
      $('#script-title').textContent = project.title; $('#script-sub').textContent = `${project.id} · new hand-written script`;
      $('#script-version').hidden = true;
      $('#script-editor').innerHTML = S.script.data.lines.map((l, k) => lineEditor(l, k, hing)).join('');
      $('#script-config-card').innerHTML = `<h4>Written for</h4><p>${esc(project.config.language.name)}<br>${esc(project.config.narration.personalityName)}<br>${project.config.durationSeconds} s target</p>`;
      ['#btn-add-line', '#btn-save-version'].forEach((b) => ($(b).disabled = false));
      updateStats(); updateButtons(); refreshProjects(); go('scripts');
    } catch (e) { const errs = e.data?.errors?.map((x) => x.message) || [e.message]; $('#form-errors').hidden = false; $('#form-errors').innerHTML = errs.map((m) => `<div>✖ ${esc(m)}</div>`).join(''); }
  };
  $('#btn-render').onclick = () => submit('render');
  $('#btn-cancel').onclick = async () => { if (S.job && confirm('Cancel this job? Running processes will be stopped.')) await api(`/api/jobs/${S.job.jobId}/cancel`, { method: 'POST' }).catch((e) => toast(e.message)); };
  $('#btn-retry').onclick = async () => { if (!S.job) return; try { const r = await api(`/api/jobs/${S.job.jobId}/retry`, { method: 'POST' }); attachJob(r.jobId); } catch (e) { toast(e.message); } };
  $('#btn-toggle-log').onclick = () => { const l = $('#job-log'); l.hidden = !l.hidden; $('#btn-toggle-log').textContent = l.hidden ? 'Show log' : 'Hide log'; };
  $('#btn-close-modal').onclick = () => { $('#modal-player').pause(); $('#modal-player').src = ''; $('#video-modal').style.display = 'none'; };
  $('#script-editor').addEventListener('input', updateStats);
  $('#script-version').onchange = (e) => loadScript(S.script.project.id, +e.target.value);
  $('#btn-add-line').onclick = () => { $('#script-editor').insertAdjacentHTML('beforeend', lineEditor({ text: '' }, $$('.line-edit').length, S.script.project.config.language.id === 'hinglish')); };
  $('#btn-save-version').onclick = () => saveVersion(false);
  $('#btn-regenerate').onclick = () => { loadFormFromConfig(S.script.project.config); S.preview = { projectId: S.script.project.id, version: S.script.version, fingerprint: fingerprintOf(inputFromConfig(S.script.project.config)) }; submit('preview'); };
  $('#btn-approve-render').onclick = async () => {
    const v = await saveVersion(true); if (!v) return;
    loadFormFromConfig(S.script.project.config); S.preview = { projectId: S.script.project.id, version: v, fingerprint: fingerprintOf(inputFromConfig(S.script.project.config)) }; store.set('studio.preview', S.preview);
    go('create'); setTimeout(() => submit('render'), 400);
  };
  try {
    [S.catalog, S.system, S.trends] = await Promise.all([api('/api/catalog'), api('/api/system'), api('/api/trends')]);
  } catch (e) { document.body.insertAdjacentHTML('afterbegin', `<div class="fatal">Studio server unreachable: ${esc(e.message)}</div>`); return; }
  S.preview = store.get('studio.preview');
  fillForm(); renderSettings(); renderRosters(); await refreshProjects();
  if (location.hash.length > 1) go(location.hash.slice(1));
  if (S.preview) loadScript(S.preview.projectId, S.preview.version).catch(() => { S.preview = null; store.set('studio.preview', null); renderPreviewState(); });
  // re-attach to a running job (refresh-safe), else show the last job's final state
  const active = await api('/api/jobs/active').catch(() => []);
  const last = store.get('studio.activeJob'), linked = new URLSearchParams(location.search).get('job');
  if (linked) attachJob(linked);
  else if (active.length) attachJob(active[0].jobId); else if (last) api(`/api/jobs/${last}`).then(() => attachJob(last)).catch(() => {});
  setInterval(async () => { try { S.system = await api('/api/system'); renderSettings(); } catch {} }, 30000);
});
