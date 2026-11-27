// AI Video Quality Inspector Dashboard UI
(function () {
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  let currentProject = null;
  let reports = [];
  let currentReport = null;
  let statusInfo = null;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function scoreBadge(score, status) {
    if (status === 'NOT_INSPECTED') return '<span class="badge" style="background:#475569;color:#fff;">NOT INSPECTED</span>';
    if (status === 'NOT_RENDERED') return '<span class="badge" style="background:#334155;color:#94a3b8;">NO RENDER</span>';
    if (status === 'BLOCKED_BY_QUOTA') return '<span class="badge" style="background:#dc2626;color:#fff;">BLOCKED BY QUOTA</span>';
    if (status === 'BLOCKED_BY_ERROR') return '<span class="badge" style="background:#dc2626;color:#fff;">BLOCKED BY ERROR</span>';
    if (status === 'PASS') return `<span class="badge" style="background:#16a34a;color:#fff;">PASS (${score}/100)</span>`;
    if (status === 'REVIEW') return `<span class="badge" style="background:#ca8a04;color:#fff;">REVIEW (${score}/100)</span>`;
    return `<span class="badge" style="background:#dc2626;color:#fff;">FAILED (${score}/100)</span>`;
  }

  function getStatusColor(status) {
    switch (status) {
      case 'PASS': return '#16a34a';
      case 'REVIEW': return '#ca8a04';
      case 'CORRECTING':
      case 'REINSPECTING':
      case 'INSPECTING': return '#2563eb';
      case 'NOT_INSPECTED': return '#475569';
      case 'NOT_RENDERED': return '#334155';
      default: return '#dc2626';
    }
  }

  async function loadStatus() {
    try {
      statusInfo = await api('/api/quality/status');
    } catch {
      statusInfo = { model: 'gemini-3.1-flash-lite', approved: true, quotaExhausted: false };
    }
  }

  async function loadReports() {
    try {
      reports = await api('/api/quality/reports');
    } catch {
      reports = [];
    }

    // Fallback: if quality reports endpoint is empty or failed, fetch regular projects
    if (!reports || reports.length === 0) {
      try {
        const prs = await api('/api/projects');
        reports = (prs || []).map((p) => ({
          projectId: p.id,
          title: p.title || p.id,
          status: p.status === 'rendered' ? 'NOT_INSPECTED' : 'NOT_RENDERED',
          overallScore: null,
          publishAllowed: false,
          hasRender: p.status === 'rendered',
        }));
      } catch {
        reports = [];
      }
    }
  }

  async function selectProject(projectId) {
    currentProject = reports.find((r) => r.projectId === projectId) || { id: projectId };
    currentReport = null;
    try {
      currentReport = await api(`/api/quality/reports/${projectId}`);
    } catch {
      currentReport = null;
    }
    render();
  }

  async function inspectCurrent(force = true) {
    if (!currentProject) return;
    const btn = document.getElementById('btn-inspect-now');
    const heroBtn = document.getElementById('btn-hero-inspect');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Inspecting (Multimodal AI + FFmpeg)...';
    }
    if (heroBtn) {
      heroBtn.disabled = true;
      heroBtn.textContent = 'Inspecting Video...';
    }

    try {
      currentReport = await api(`/api/quality/inspect/${currentProject.id || currentProject.projectId}`, {
        method: 'POST',
        body: { force },
      });
      await loadReports();
      currentProject = reports.find((r) => r.projectId === (currentProject.id || currentProject.projectId)) || currentProject;
      render();
    } catch (err) {
      alert(`Inspection error: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Re-Inspect Video';
      }
      if (heroBtn) {
        heroBtn.disabled = false;
        heroBtn.textContent = 'Run Quality Inspection Now';
      }
    }
  }

  async function autoCorrectCurrent() {
    if (!currentProject) return;
    const btn = document.getElementById('btn-correct-now');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Applying Corrections...';
    }

    try {
      const res = await api(`/api/quality/correct/${currentProject.id || currentProject.projectId}`, { method: 'POST' });
      alert(`Automatic corrections applied to ${res.applied?.modifiedScenes?.length || 0} scene(s).`);
      await inspectCurrent(true);
    } catch (err) {
      alert(`Correction error: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Auto-Correct Failed Scenes';
      }
    }
  }

  function render() {
    const root = document.getElementById('quality-root');
    if (!root) return;

    const rep = currentReport;
    const hasReport = Boolean(rep);
    const score = rep ? rep.overallScore : null;
    const status = rep ? rep.status : (currentProject?.status || 'NOT_INSPECTED');
    const cat = rep?.categoryScores || {};
    const curId = currentProject?.id || currentProject?.projectId;

    root.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
        <div>
          <h2 style="margin:0 0 0.25rem 0;">AI Video Quality Inspector & Correction Engine</h2>
          <p class="muted" style="margin:0;">Multimodal visual verification, temporal motion analysis, and zero-cost publishing protection</p>
        </div>
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
          <span class="badge" style="background:#1e293b; color:#94a3b8; border:1px solid #334155;">
            Model: <strong style="color:#38bdf8;">${esc(statusInfo?.model || 'gemini-3.1-flash-lite')}</strong> (Free Tier)
          </span>
          <span class="badge" style="background:${statusInfo?.quotaExhausted ? '#dc2626' : '#16a34a'}; color:#fff;">
            Quota: ${statusInfo?.quotaExhausted ? 'EXHAUSTED (Safe Pause)' : 'ACTIVE'}
          </span>
          <span class="badge" style="background:#1e293b; color:#94a3b8; border:1px solid #334155;">
            Pass Min: <strong style="color:#fff;">${statusInfo?.config?.minScore || 85}/100</strong>
          </span>
        </div>
      </div>

      <!-- Selector & Actions -->
      <div style="background:#0f172a; padding:1.25rem; border-radius:8px; border:1px solid #1e293b; margin-bottom:1.5rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
        <div style="display:flex; align-items:center; gap:0.75rem; flex-grow:1; max-width:650px;">
          <label style="font-weight:600; font-size:0.95rem; white-space:nowrap;">Select Video Project:</label>
          <select id="quality-project-select" style="background:#1e293b; color:#fff; border:1px solid #334155; padding:0.6rem 1rem; border-radius:6px; font-size:0.95rem; width:100%; min-width:320px; cursor:pointer;">
            ${reports.length === 0 ? '<option value="">No projects available</option>' : ''}
            ${reports.map(r => {
              const labelScore = r.overallScore != null ? `(${r.status} - ${r.overallScore}/100)` : (r.status === 'NOT_RENDERED' ? '(No Render Yet)' : '(Not Inspected)');
              return `<option value="${r.projectId}" ${r.projectId === curId ? 'selected' : ''}>${esc(r.title || r.projectId)} ${labelScore}</option>`;
            }).join('')}
          </select>
        </div>
        <div style="display:flex; gap:0.5rem;">
          <button id="btn-inspect-now" class="btn btn-primary btn-sm" ${reports.length === 0 ? 'disabled' : ''}>
            ${hasReport ? 'Re-Inspect Video' : 'Inspect Video'}
          </button>
          <button id="btn-correct-now" class="btn btn-secondary btn-sm" ${rep && rep.status !== 'PASS' ? '' : 'disabled'}>
            Auto-Correct Failed Scenes
          </button>
        </div>
      </div>

      ${hasReport ? `
        <!-- Main Score Cards -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
          <div style="background:#1e293b; padding:1.25rem; border-radius:8px; border-left:4px solid ${getStatusColor(status)};">
            <div style="font-size:0.85rem; color:#94a3b8; text-transform:uppercase; font-weight:600;">Overall Quality Score</div>
            <div style="font-size:2.5rem; font-weight:800; color:#fff; margin:0.25rem 0;">
              ${score}<span style="font-size:1.2rem; color:#64748b;">/100</span>
            </div>
            <div>${scoreBadge(score, status)}</div>
          </div>

          <div style="background:#1e293b; padding:1.25rem; border-radius:8px; border-left:4px solid ${rep.publishAllowed ? '#16a34a' : '#dc2626'};">
            <div style="font-size:0.85rem; color:#94a3b8; text-transform:uppercase; font-weight:600;">Publishing Decision</div>
            <div style="font-size:1.3rem; font-weight:700; color:${rep.publishAllowed ? '#4ade80' : '#f87171'}; margin:0.5rem 0;">
              ${rep.publishAllowed ? 'AUTHORIZED FOR YOUTUBE' : 'PUBLISHING BLOCKED'}
            </div>
            <div style="font-size:0.8rem; color:#94a3b8;">
              ${rep.reasons?.length ? esc(rep.reasons.join('; ')) : 'All mandatory technical and semantic quality checks passed.'}
            </div>
          </div>

          <div style="background:#1e293b; padding:1.25rem; border-radius:8px;">
            <div style="font-size:0.85rem; color:#94a3b8; text-transform:uppercase; font-weight:600;">Inspection Metadata</div>
            <div style="font-size:0.85rem; color:#cbd5e1; margin-top:0.5rem;">
              <div><strong>SHA256:</strong> <code>${esc((rep.videoSha256 || '').slice(0, 16))}...</code></div>
              <div><strong>Defects Found:</strong> <span style="color:${rep.defects?.length ? '#f87171' : '#4ade80'};">${rep.defects?.length || 0}</span></div>
              <div><strong>Retry Count:</strong> ${rep.retryCount || 0} / 3</div>
              <div><strong>Inspected At:</strong> ${new Date(rep.inspectedAt).toLocaleString()}</div>
            </div>
          </div>
        </div>

        <!-- Category Scores Grid (100 pts) -->
        <div style="background:#0f172a; padding:1.25rem; border-radius:8px; border:1px solid #1e293b; margin-bottom:1.5rem;">
          <h3 style="margin-top:0; margin-bottom:1rem; font-size:1.1rem;">Category Score Breakdown (Weighted 100 Points)</h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:1rem;">
            ${[
              ['Visual Quality', cat.visualQuality, 15, 'Image clarity, sharpness, lighting'],
              ['Animation & Movement', cat.animationQuality, 15, 'Smooth motion, no frozen frames'],
              ['Character & Object Interactions', cat.characterObjectInteractions, 15, 'Action progression, hand contact'],
              ['Script & Narration Matching', cat.scriptNarrationMatching, 15, 'Contextual scene matching'],
              ['Story Continuity', cat.storyContinuity, 10, 'Visual & temporal progression'],
              ['Camera & Cinematic Quality', cat.cameraCinematicQuality, 5, 'Framing, zoom, angles'],
              ['Voice & Audio Quality', cat.voiceAudioQuality, 10, 'Voice clarity, non-silent, volume'],
              ['Captions & Synchronization', cat.captionsSynchronization, 5, 'Subtitle timing & line length'],
              ['Technical Integrity', cat.technicalIntegrity, 10, '1080x1920, 30fps, valid MP4'],
            ].map(([name, val, max, desc]) => `
              <div style="background:#1e293b; padding:0.75rem; border-radius:6px;">
                <div style="display:flex; justify-content:space-between; font-weight:600; font-size:0.85rem;">
                  <span>${name}</span>
                  <span style="color:${(val || 0) >= max * 0.85 ? '#4ade80' : (val || 0) >= max * 0.65 ? '#facc15' : '#f87171'};">
                    ${val || 0}/${max}
                  </span>
                </div>
                <div style="background:#0f172a; height:6px; border-radius:3px; margin:0.4rem 0; overflow:hidden;">
                  <div style="background:${(val || 0) >= max * 0.85 ? '#16a34a' : (val || 0) >= max * 0.65 ? '#ca8a04' : '#dc2626'}; height:100%; width:${((val || 0) / max) * 100}%;"></div>
                </div>
                <div style="font-size:0.75rem; color:#64748b;">${desc}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Defect List -->
        <div style="background:#0f172a; padding:1.25rem; border-radius:8px; border:1px solid #1e293b; margin-bottom:1.5rem;">
          <h3 style="margin-top:0; margin-bottom:0.75rem; font-size:1.1rem;">
            Detected Defects & Timestamped Evidence (${(rep.defects || []).length})
          </h3>
          ${(rep.defects || []).length === 0 ? `
            <p style="color:#4ade80; margin:0;">No quality defects detected. Video passed all checks.</p>
          ` : `
            <div style="display:flex; flex-direction:column; gap:0.5rem; max-height:300px; overflow-y:auto;">
              ${rep.defects.map(d => `
                <div style="background:#1e293b; padding:0.6rem 0.8rem; border-radius:4px; border-left:3px solid ${d.severity === 'critical' ? '#dc2626' : '#eab308'}; display:flex; justify-content:space-between; align-items:center;">
                  <div>
                    <span style="font-family:monospace; background:#0f172a; padding:2px 6px; border-radius:4px; font-size:0.8rem; color:#38bdf8;">
                      ${d.timestamp != null ? `${Number(d.timestamp).toFixed(1)}s` : 'General'}
                    </span>
                    <strong style="margin-left:0.5rem; font-size:0.85rem; color:#f1f5f9;">${esc(d.category || 'General')}:</strong>
                    <span style="font-size:0.85rem; color:#cbd5e1;">${esc(d.description)}</span>
                  </div>
                  <span class="badge" style="background:${d.severity === 'critical' ? '#dc2626' : '#ca8a04'}; color:#fff; font-size:0.7rem;">
                    ${d.severity?.toUpperCase()}
                  </span>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Scene-by-Scene Breakdown -->
        <div style="background:#0f172a; padding:1.25rem; border-radius:8px; border:1px solid #1e293b;">
          <h3 style="margin-top:0; margin-bottom:0.75rem; font-size:1.1rem;">Scene Quality & Interaction Analysis</h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:1rem;">
            ${(rep.scenes || []).map(sc => `
              <div style="background:#1e293b; padding:0.85rem; border-radius:6px; border-left:3px solid ${sc.passed ? '#16a34a' : '#dc2626'};">
                <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
                  <strong>${esc(sc.sceneId)} (${(sc.timestampStart || 0).toFixed(1)}s - ${(sc.timestampEnd || 0).toFixed(1)}s)</strong>
                  <span style="color:${sc.passed ? '#4ade80' : '#f87171'}; font-weight:600; font-size:0.8rem;">
                    ${sc.passed ? 'PASS' : 'ISSUE'}
                  </span>
                </div>
                <div style="font-size:0.8rem; color:#94a3b8; margin-bottom:0.3rem;">
                  <strong>Narration:</strong> "${esc(sc.narration || '–')}"
                </div>
                <div style="font-size:0.8rem; color:#94a3b8; margin-bottom:0.3rem;">
                  <strong>Intended Action:</strong> ${esc(sc.intendedAction || '–')}
                </div>
                ${sc.correctionInstruction ? `
                  <div style="background:#0f172a; padding:0.4rem; border-radius:4px; font-size:0.75rem; color:#facc15; margin-top:0.4rem;">
                    <strong>AI Correction Instruction:</strong> ${esc(sc.correctionInstruction)}
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <div style="text-align:center; padding:3.5rem 1.5rem; background:#0f172a; border-radius:8px; border:1px dashed #334155;">
          <h3 style="margin:0 0 0.5rem 0; color:#f8fafc;">
            ${currentProject ? esc(currentProject.title || currentProject.projectId) : 'No Project Selected'}
          </h3>
          <p style="color:#94a3b8; max-width:480px; margin:0 auto 1.5rem auto;">
            This video has not yet been inspected by the Quality Gate. Run the inspection to analyze visual quality, animation, audio, and YouTube publishing eligibility.
          </p>
          <button id="btn-hero-inspect" class="btn btn-primary" style="padding:0.6rem 1.5rem; font-size:1rem;" ${!currentProject ? 'disabled' : ''}>
            Run Quality Inspection Now
          </button>
        </div>
      `}
    `;

    const select = document.getElementById('quality-project-select');
    if (select) {
      select.onchange = (e) => selectProject(e.target.value);
    }

    const btnInspect = document.getElementById('btn-inspect-now');
    if (btnInspect) btnInspect.onclick = () => inspectCurrent(true);

    const btnHeroInspect = document.getElementById('btn-hero-inspect');
    if (btnHeroInspect) btnHeroInspect.onclick = () => inspectCurrent(true);

    const btnCorrect = document.getElementById('btn-correct-now');
    if (btnCorrect) btnCorrect.onclick = () => autoCorrectCurrent();
  }

  window.QualityUI = {
    async show() {
      await loadStatus();
      await loadReports();

      // Automatically select the first project that has an inspection report, or the first project with a render
      if (!currentProject && reports.length > 0) {
        const withReport = reports.find((r) => r.overallScore != null);
        const withRender = reports.find((r) => r.hasRender);
        const target = withReport || withRender || reports[0];
        await selectProject(target.projectId);
      } else if (currentProject) {
        await selectProject(currentProject.id || currentProject.projectId);
      } else {
        render();
      }
    },
  };
})();
