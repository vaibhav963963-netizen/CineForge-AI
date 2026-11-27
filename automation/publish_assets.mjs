// Publish assets: thumbnail extraction from rendered MP4 and SRT caption generation.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS } from '../dashboard/lib/workspace.js';

const FF = PATHS.ffmpeg || 'ffmpeg';

export function formatSrtTime(sec) {
  const s = Math.max(0, +sec || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

export function parseSrtTime(str) {
  const m = String(str || '').trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!m) throw new Error(`Invalid SRT timestamp: "${str}"`);
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

export function buildSrtFromLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('lines must be a non-empty array');
  const blocks = [];
  let prevEnd = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const l = lines[idx];
    const text = String(l.text || l.caption || '').trim();
    if (!text) continue;
    let start = Number(l.start);
    let end = Number(l.end);
    if (!Number.isFinite(start)) start = prevEnd;
    if (!Number.isFinite(end) || end <= start) end = start + 3;
    if (start < prevEnd) start = prevEnd;
    if (end <= start) end = start + 0.5;
    blocks.push({
      index: blocks.length + 1,
      start,
      end,
      text,
    });
    prevEnd = end;
  }
  return blocks.map((b) => `${b.index}\n${formatSrtTime(b.start)} --> ${formatSrtTime(b.end)}\n${b.text}\n`).join('\n');
}

export function parseAndValidateSrt(srtContent) {
  if (typeof srtContent !== 'string' || !srtContent.trim()) {
    return { ok: false, error: 'Empty or non-string SRT content' };
  }
  const rawBlocks = srtContent.trim().split(/\r?\n\r?\n/);
  const blocks = [];
  let prevEnd = -0.001;
  for (let i = 0; i < rawBlocks.length; i++) {
    const lines = rawBlocks[i].trim().split(/\r?\n/);
    if (lines.length < 3) return { ok: false, error: `Block ${i + 1} has insufficient lines (< 3)` };
    const idx = parseInt(lines[0], 10);
    if (idx !== i + 1) return { ok: false, error: `Block ${i + 1} has index ${lines[0]}, expected ${i + 1}` };
    const arrow = lines[1].split('-->');
    if (arrow.length !== 2) return { ok: false, error: `Block ${i + 1} invalid timestamp line "${lines[1]}"` };
    let start, end;
    try {
      start = parseSrtTime(arrow[0]);
      end = parseSrtTime(arrow[1]);
    } catch (e) {
      return { ok: false, error: `Block ${i + 1} timestamp parse error: ${e.message}` };
    }
    if (end <= start) return { ok: false, error: `Block ${i + 1} end (${end}) <= start (${start})` };
    if (start < prevEnd) return { ok: false, error: `Block ${i + 1} start (${start}) before previous end (${prevEnd}): non-monotonic` };
    const text = lines.slice(2).join(' ').trim();
    if (!text) return { ok: false, error: `Block ${i + 1} text is empty` };
    blocks.push({ index: idx, start, end, text });
    prevEnd = end;
  }
  return { ok: true, count: blocks.length, blocks };
}

export function measureLuma(imagePath) {
  const r = spawnSync(FF, ['-hide_banner', '-i', imagePath, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
  const m = String(r.stdout || '').match(/signalstats\.YAVG=([\d.]+)/);
  return m ? parseFloat(m[1]) : NaN;
}

export function extractThumbnail({ videoPath, outPath, duration, targetFraction = 0.35, minLuma = 18 }) {
  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);
  const dur = Number(duration) > 0 ? Number(duration) : 45;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const candidates = [targetFraction, 0.45, 0.25, 0.55, 0.15, 0.65];
  let bestFile = null, bestLuma = -1;

  for (const frac of candidates) {
    const ss = (dur * frac).toFixed(2);
    const tmp = `${outPath}.candidate.jpg`;
    const r = spawnSync(FF, [
      '-y', '-ss', ss, '-i', videoPath,
      '-vframes', '1',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
      '-q:v', '2',
      tmp
    ], { encoding: 'utf8', windowsHide: true });

    if (r.status === 0 && fs.existsSync(tmp)) {
      const luma = measureLuma(tmp);
      if (luma > bestLuma) {
        bestLuma = luma;
        bestFile = tmp;
      }
      if (luma >= minLuma) {
        fs.copyFileSync(tmp, outPath);
        try { fs.rmSync(tmp, { force: true }); } catch {}
        const bytes = fs.statSync(outPath).size;
        return { ok: true, outPath, timestamp: ss, luma, bytes, passed: true };
      }
    }
  }

  if (bestFile && fs.existsSync(bestFile)) {
    fs.copyFileSync(bestFile, outPath);
    try { fs.rmSync(bestFile, { force: true }); } catch {}
    const bytes = fs.statSync(outPath).size;
    return { ok: true, outPath, luma: bestLuma, bytes, passed: bestLuma >= minLuma, warning: `Best frame luma (${bestLuma.toFixed(1)}) below target (${minLuma})` };
  }

  throw new Error(`Failed to extract valid thumbnail from ${videoPath}`);
}
