// Intelligent Frame Extractor using FFmpeg
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS } from '../dashboard/lib/workspace.js';

export class FrameExtractor {
  constructor(options = {}) {
    this.ffmpegPath = options.ffmpegPath || PATHS.ffmpeg;
    this.ffprobePath = options.ffprobePath || PATHS.ffprobe;
  }

  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Extract frames at specified timestamps (in seconds).
   */
  extractFramesAtTimestamps(videoPath, timestamps, outputDir, prefix = 'frame') {
    this.ensureDir(outputDir);
    const extracted = [];

    for (const [index, time] of timestamps.entries()) {
      const filename = `${prefix}_${String(index).padStart(4, '0')}_${time.toFixed(2)}s.jpg`;
      const outPath = path.join(outputDir, filename);

      const args = [
        '-ss', time.toFixed(3),
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '2',
        '-vf', 'scale=540:960', // Downscale for inspection efficiency and lower token count
        '-y',
        outPath,
      ];

      const res = spawnSync(this.ffmpegPath, args, { encoding: 'utf8', windowsHide: true });
      if (res.status === 0 && fs.existsSync(outPath)) {
        extracted.push({
          timestamp: time,
          path: outPath,
          filename,
        });
      }
    }

    return extracted;
  }

  /**
   * Intelligently sample frames for a scene or entire video.
   * Extracts start, quarter, midpoint, three-quarter, and end of scene,
   * plus 2 fps intermediate samples if duration > 3s.
   */
  sampleSceneFrames(videoPath, scene, outputDir) {
    this.ensureDir(outputDir);
    const start = scene.start || 0;
    const end = scene.end || start + 3;
    const dur = end - start;

    const timestamps = new Set();
    // Key moments in scene: start, 25%, 50%, 75%, end (avoiding exact 0 edge)
    timestamps.add(Math.max(0, start + 0.1));
    timestamps.add(start + dur * 0.25);
    timestamps.add(start + dur * 0.5);
    timestamps.add(start + dur * 0.75);
    timestamps.add(Math.max(start, end - 0.1));

    // Sample at ~2 fps across the scene
    for (let t = start + 0.5; t < end - 0.5; t += 0.5) {
      timestamps.add(Number(t.toFixed(2)));
    }

    const sortedTimes = [...timestamps].sort((a, b) => a - b);
    return this.extractFramesAtTimestamps(
      videoPath,
      sortedTimes,
      outputDir,
      `scene_${scene.id || 'S01'}`
    );
  }

  /**
   * Extract sequence of frames around a suspected interaction or animation jump.
   */
  extractTemporalSequence(videoPath, centerTime, windowSeconds = 1.0, fps = 4, outputDir, prefix = 'temporal') {
    this.ensureDir(outputDir);
    const start = Math.max(0, centerTime - windowSeconds / 2);
    const end = centerTime + windowSeconds / 2;
    const step = 1 / fps;

    const times = [];
    for (let t = start; t <= end; t += step) {
      times.push(Number(t.toFixed(3)));
    }

    return this.extractFramesAtTimestamps(videoPath, times, outputDir, `${prefix}_${centerTime.toFixed(1)}s`);
  }

  /**
   * Convert image file to base64 for Gemini inlineData
   */
  toBase64(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    return data.toString('base64');
  }
}
