// CineForge screen: one card per visual style, with its sets, the result of its last render, and its video. One render runs at a
// time (the GPU is shared); while it runs the other buttons are disabled and the page refreshes until it finishes.
(function () {
  const STYLE_CSS = `
    #cineforge-root .cf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-top: 12px; }
    #cineforge-root .cf-card { padding: 16px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
    #cineforge-root .cf-card h3 { margin: 0 0 6px; }
    #cineforge-root .cf-error { color: #ff8a8a; font-size: 13px; word-break: break-word; }
    #cineforge-root .cf-running { color: #FFD43B; font-weight: 600; }
  `;
  const root = () => document.getElementById('cineforge-root');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let timer = null;

  function card(s, busy) {
    const last = s.lastRender
      ? `${s.lastRender.shots} shots · inspection ${s.lastRender.inspection ? 'passed' : 'FAILED'}${s.lastRender.renderSeconds != null ? ` · rendered in ${s.lastRender.renderSeconds} s` : ''}`
      : 'not rendered yet';
    return `<div class="cf-card">
      <h3>${esc(s.label)}</h3>
      <p class="muted">Sets: ${s.sets.map(esc).join(', ')}</p>
      <p>Status: <strong>${esc(s.status)}</strong><br><span class="muted">${esc(last)}</span></p>
      ${s.error ? `<p class="cf-error">${esc(s.error)}</p>` : ''}
      <button class="btn btn-secondary" data-render="${esc(s.id)}" ${busy ? 'disabled' : ''}>${s.running ? 'Rendering…' : 'Render test video'}</button>
      ${s.video ? `<video controls playsinline preload="none" src="${esc(s.video)}" style="width:100%;margin-top:10px;border-radius:12px"></video>` : ''}
    </div>`;
  }

  function render(styles, jobs) {
    const busy = !!jobs.running;
    root().innerHTML = `<div>
        <p class="muted">Each style renders the same test sentences with its own sets, characters and captions. The narration is generated offline, and every video is measured before it is accepted.</p>
        ${busy ? `<p class="cf-running">Rendering ${esc(jobs.running.style)}… started ${new Date(jobs.running.startedAt).toLocaleTimeString()}</p>` : ''}
      </div>
      <div class="cf-grid">${styles.map((s) => card(s, busy)).join('')}</div>`;
    root().querySelectorAll('[data-render]').forEach((b) => b.addEventListener('click', () => start(b.dataset.render)));
    return busy;
  }

  async function load() {
    const [st, jobs] = await Promise.all([
      fetch('/api/cineforge/styles').then((r) => r.json()),
      fetch('/api/cineforge/jobs').then((r) => r.json()),
    ]);
    return render(st.styles, jobs);
  }

  function follow() {
    clearInterval(timer);
    timer = setInterval(async () => {
      const busy = await load().catch(() => false);
      if (!busy) clearInterval(timer);
    }, 4000);
  }

  async function start(style) {
    const r = await fetch('/api/cineforge/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'The render could not start.'); return; }
    await load();
    follow();
  }

  function ensureCss() {
    if (document.getElementById('cineforge-css')) return;
    const s = document.createElement('style'); s.id = 'cineforge-css'; s.textContent = STYLE_CSS; document.head.appendChild(s);
  }

  window.CineForgeUI = {
    async show() {
      ensureCss();
      const busy = await load().catch((e) => { root().innerHTML = `<p class="cf-error">${esc(e.message)}</p>`; return false; });
      if (busy) follow();
    },
  };
})();
