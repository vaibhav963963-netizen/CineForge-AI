// Motion & Animation Quality Analyzer
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PATHS } from '../dashboard/lib/workspace.js';

export class MotionAnalyzer {
  constructor(options = {}) {
    this.ffmpegPath = options.ffmpegPath || PATHS.ffmpeg;
    this.maxStaticSec = options.maxStaticSec || 1.5;
  }

  /**
   * Run FFmpeg freezedetect and scene delta analysis on the entire MP4.
   */
  analyzeMotion(videoPath) {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const freezes = [];
    const blackGaps = [];
    const abruptJumps = [];
    const defects = [];

    // 1. Freeze detection (> 1.5s frozen frame)
    const freezeCmd = [
      '-hide_banner',
      '-i', videoPath,
      '-vf', `freezedetect=n=-50dB:d=${this.maxStaticSec},blackdetect=d=0.3:pix_th=0.08`,
      '-map', '0:v:0',
      '-f', 'null', '-',
    ];

    const res = spawnSync(this.ffmpegPath, freezeCmd, { encoding: 'utf8', windowsHide: true });
    const output = (res.stderr || '') + '\n' + (res.stdout || '');

    // Parse freezes
    const freezeStarts = [...output.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => +m[1]);
    const freezeEnds = [...output.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => +m[1]);
    const freezeDurs = [...output.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => +m[1]);

    for (let i = 0; i < freezeStarts.length; i++) {
      const start = freezeStarts[i];
      const end = freezeEnds[i] || start + (freezeDurs[i] || this.maxStaticSec);
      const dur = freezeDurs[i] || (end - start);

      freezes.push({ start, end, duration: dur });
      defects.push({
        timestamp: start,
        category: 'animationQuality',
        type: 'frozen_animation',
        severity: dur > 2.5 ? 'critical' : 'warning',
        description: `Frozen animation detected from ${start.toFixed(2)}s to ${end.toFixed(2)}s (${dur.toFixed(2)}s duration).`,
        evidence: `freeze_duration: ${dur.toFixed(2)}s`,
      });
    }

    // Parse black frames
    const blackMatches = [...output.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)\s+black_duration:\s*([\d.]+)/g)];
    for (const m of blackMatches) {
      const start = +m[1];
      const end = +m[2];
      const dur = +m[3];
      blackGaps.push({ start, end, duration: dur });

      // Minor fade-in or fade-out is acceptable at start/end (<0.5s), but gaps in the middle are defects
      if (start > 0.5 && dur > 0.3) {
        defects.push({
          timestamp: start,
          category: 'visualQuality',
          type: 'black_frame_gap',
          severity: 'critical',
          description: `Unexpected black frame gap from ${start.toFixed(2)}s to ${end.toFixed(2)}s (${dur.toFixed(2)}s).`,
          evidence: `blackdetect: ${dur.toFixed(2)}s gap`,
        });
      }
    }

    // 2. Measure scene motion score distribution using lavfi scene filter
    const sceneScores = [];
    const sceneCmd = [
      '-hide_banner',
      '-i', videoPath,
      '-vf', 'fps=4,select=gt(scene\\,0.001),metadata=print:key=lavfi.scene_score:file=-',
      '-an',
      '-f', 'null', '-',
    ];
    const sRes = spawnSync(this.ffmpegPath, sceneCmd, { encoding: 'utf8', windowsHide: true });
    const sLines = (sRes.stdout || '').split(/\r?\n/);
    let curTime = 0;
    for (const l of sLines) {
      const tm = l.match(/pts_time:([\d.]+)/);
      if (tm) curTime = +tm[1];
      const sm = l.match(/lavfi\.scene_score=([\d.]+)/);
      if (sm) sceneScores.push({ timestamp: curTime, score: +sm[1] });
    }

    // Calculate motion smoothness & motion presence
    const avgMotion =
      sceneScores.length > 0
        ? sceneScores.reduce((acc, val) => acc + val.score, 0) / sceneScores.length
        : 0;

    let animationScore = 15;
    if (freezes.length > 0) {
      const totalFreezeTime = freezes.reduce((a, b) => a + b.duration, 0);
      animationScore -= Math.min(10, totalFreezeTime * 3);
    }
    if (sceneScores.length === 0 || avgMotion < 0.005) {
      animationScore -= 5;
      defects.push({
        timestamp: 0,
        category: 'animationQuality',
        type: 'insufficient_motion',
        severity: 'warning',
        description: 'Video exhibits very low dynamic motion throughout its duration.',
        evidence: `avgSceneScore: ${avgMotion.toFixed(4)}`,
      });
    }

    animationScore = Math.max(0, Math.min(15, Math.round(animationScore)));

    return {
      score: animationScore,
      maxScore: 15,
      freezes,
      blackGaps,
      avgMotion,
      sceneScoreCount: sceneScores.length,
      defects,
      passed: freezes.length === 0 && blackGaps.length === 0,
    };
  }
}
