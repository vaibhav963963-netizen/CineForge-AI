// Studio runtime boot: fonts → scene (storyboard + style + character) → script + timing → captions → (WebGL engine
// for 3D styles only) → director shots. draw(t) renders film time t as a pure function of t, so frame capture is
// exact. window.OP is the API tools/capture.mjs drives: ready, bootError, duration(), draw(t), frame(t, q), shots(),
// captions(), cues().
import { W, H, setCtx, ctx, clamp } from './core/lib.js';
import { T, loadTiming } from './core/timing.js';
import { buildCaptions, drawCaption, captionList } from './core/captions.js';
import { buildDirector, TEST } from './director/director.js';

const cv = document.getElementById('cv'), GL = document.getElementById('gl');
setCtx(cv.getContext('2d'));
const OP = (window.OP = { ready: false });

function draw(t) {
  t = clamp(t, 0, T.dur - 1e-4);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.letterSpacing = '0px'; ctx.filter = 'none';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const S = OP._shots; let i = S.length - 1; while (i > 0 && S[i].at > t) i--;
  const sh = S[i], end = i < S.length - 1 ? S[i + 1].at : T.dur, d = end - sh.at, lt = t - sh.at;
  const blit = () => ctx.drawImage(GL, 0, 0, W, H);
  ctx.save(); sh.draw(lt, d, t, blit); ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.letterSpacing = '0px';
  const fade = Math.min(clamp(t / 0.25), clamp((T.dur - t) / 0.4));
  if (fade < 1) { ctx.fillStyle = '#000'; ctx.globalAlpha = 1 - fade; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  drawCaption(t);
}

(async () => {
  try {
    const scene = await (await fetch('scenes/scene.json', { cache: 'no-store' })).json();
    const script = await (await fetch('script.json', { cache: 'no-store' })).json();
    for (const f of scene.fonts || []) await document.fonts.load(`${f.weight} 100px '${f.family}'`, f.sample || 'A').catch(() => {});
    if ((scene.fonts || []).some((f) => f.family === 'StudioDeva') && !document.fonts.check(`800 100px 'StudioDeva'`, 'अ')) throw new Error('Devanagari caption font failed to load');
    await loadTiming();
    buildCaptions(script, scene.style.captions, scene.language);
    let E = null, three = null;
    if (scene.style.renderer === 'webgl') {
      const [THREE, eng, stage] = await Promise.all([import('three'), import('./core/engine.js'), import('./director/stage3d.js')]);
      GL.width = Math.round(1080 * eng.RES); GL.height = Math.round(1920 * eng.RES);
      E = eng.makeEngine(GL, { w: GL.width, h: GL.height, samples: eng.AA });
      three = { THREE, stage, camera: eng.camera };
    }
    const { shots, cues } = await buildDirector({ scene, E, three });
    shots.sort((a, b) => a.at - b.at);
    OP._shots = shots; OP.script = script; OP.scene = scene;
    OP.duration = () => T.dur;
    OP.draw = draw;
    OP.frame = (t, q = 0.92) => { draw(t); return cv.toDataURL('image/jpeg', q); };
    OP.shots = () => shots.map((s, i) => ({ id: s.id, at: +s.at.toFixed(3), end: +(i < shots.length - 1 ? shots[i + 1].at : T.dur).toFixed(3), note: s.note || '' }));
    OP.captions = () => captionList().map((c) => ({ s: +c.s.toFixed(3), e: +c.e.toFixed(3), text: c.words.map((w) => (w.hi ? '*' : '') + w.txt).join(' ') }));
    OP.cues = () => cues.slice().sort((a, b) => a.t - b.t);
    // fraction of pixels that change when the lead character is hidden at time t (presence test)
    OP.leadPresence = (t) => { const g = cv.getContext('2d'); TEST.hideLead = false; draw(t); const a = g.getImageData(0, 0, W, H).data; TEST.hideLead = true; draw(t); const b = g.getImageData(0, 0, W, H).data; TEST.hideLead = false; let n = 0; for (let i = 0; i < a.length; i += 16) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++; return n / (a.length / 16); };
    OP.ready = true;
    const q = new URLSearchParams(location.search);
    if (!q.has('capture')) {
      if (q.has('t')) draw(+q.get('t'));
      else {
        const audio = new Audio('audio/mix.wav'); let t0 = null; const btn = document.getElementById('play'); btn.hidden = false;
        btn.onclick = () => { btn.hidden = true; t0 = performance.now(); audio.currentTime = 0; audio.play().catch(() => {}); };
        const loop = (now) => { const t = t0 == null ? 0 : (now - t0) / 1000; draw(t); if (t0 != null && t > T.dur) { t0 = null; btn.hidden = false; } requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      }
    }
  } catch (e) { OP.bootError = String(e && e.stack || e); console.error(e); }
})();
