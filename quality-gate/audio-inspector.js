// Audio & Voice Quality Inspector
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PATHS } from '../dashboard/lib/workspace.js';

export class AudioInspector {
  constructor(options = {}) {
    this.ffmpegPath = options.ffmpegPath || PATHS.ffmpeg;
    this.ffprobePath = options.ffprobePath || PATHS.ffprobe;
  }

  /**
   * Inspect the audio stream of the final rendered MP4 video.
   */
  inspectAudio(videoPath, expectedDuration, narrationSeconds) {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const defects = [];

    // 1. ffprobe audio stream info
    const probeArgs = [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,channels,sample_rate,duration,bit_rate',
      '-of', 'json',
      videoPath,
    ];
    const probeRes = spawnSync(this.ffprobePath, probeArgs, { encoding: 'utf8', windowsHide: true });
    let aStream = null;
    try {
      const j = JSON.parse(probeRes.stdout || '{}');
      aStream = j.streams?.[0] || null;
    } catch {}

    if (!aStream) {
      defects.push({
        timestamp: 0,
        category: 'voiceAudioQuality',
        type: 'missing_audio_stream',
        severity: 'critical',
        description: 'Final MP4 video contains NO audio stream.',
        evidence: 'select_streams a:0 returned empty',
      });
      return {
        score: 0,
        maxScore: 10,
        defects,
        hasAudio: false,
        passed: false,
      };
    }

    // 2. volumedetect and silencedetect via FFmpeg
    const audioFilterCmd = [
      '-hide_banner',
      '-i', videoPath,
      '-af', 'volumedetect,silencedetect=n=-45dB:d=2.0',
      '-vn',
      '-f', 'null', '-',
    ];
    const res = spawnSync(this.ffmpegPath, audioFilterCmd, { encoding: 'utf8', windowsHide: true });
    const output = (res.stderr || '') + '\n' + (res.stdout || '');

    const meanMatch = output.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
    const maxMatch = output.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
    const meanVolumeDb = meanMatch ? parseFloat(meanMatch[1]) : -20;
    const maxVolumeDb = maxMatch ? parseFloat(maxMatch[1]) : 0;

    // Detect silent intervals > 2.0s
    const silenceStarts = [...output.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => +m[1]);
    const silenceEnds = [...output.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)];
    const silentGaps = [];

    for (const m of silenceEnds) {
      const end = +m[1];
      const dur = +m[2];
      const start = end - dur;
      silentGaps.push({ start, end, duration: dur });

      // Avoid flagging introductory lead-in (<0.5s) or outro
      if (start > 0.5 && dur > 2.5) {
        defects.push({
          timestamp: start,
          category: 'voiceAudioQuality',
          type: 'unwanted_audio_silence',
          severity: 'warning',
          description: `Long silence detected from ${start.toFixed(2)}s to ${end.toFixed(2)}s (${dur.toFixed(2)}s).`,
          evidence: `silencedetect: ${dur.toFixed(2)}s at -45dB`,
        });
      }
    }

    // Volume level checks
    // Ideal mean volume for YouTube Shorts is between -14 LUFS / -18 dB and -24 dB
    if (meanVolumeDb < -40) {
      defects.push({
        timestamp: 0,
        category: 'voiceAudioQuality',
        type: 'audio_too_quiet',
        severity: 'critical',
        description: `Audio volume is extremely quiet (mean ${meanVolumeDb} dB).`,
        evidence: `mean_volume: ${meanVolumeDb} dB`,
      });
    } else if (meanVolumeDb > -10) {
      defects.push({
        timestamp: 0,
        category: 'voiceAudioQuality',
        type: 'audio_distortion_risk',
        severity: 'warning',
        description: `Audio volume is unusually loud (mean ${meanVolumeDb} dB), possible clipping.`,
        evidence: `mean_volume: ${meanVolumeDb} dB, max_volume: ${maxVolumeDb} dB`,
      });
    }

    // Audio duration check against narration seconds
    if (narrationSeconds && Math.abs((+aStream.duration || 0) - narrationSeconds) > 2.0) {
      defects.push({
        timestamp: 0,
        category: 'voiceAudioQuality',
        type: 'audio_length_mismatch',
        severity: 'warning',
        description: `Audio track duration (${aStream.duration}s) differs from narration transcript (${narrationSeconds}s).`,
        evidence: `audio: ${aStream.duration}s, narration: ${narrationSeconds}s`,
      });
    }

    let audioScore = 10;
    if (defects.some((d) => d.severity === 'critical')) audioScore = 0;
    else audioScore -= defects.length * 2;
    audioScore = Math.max(0, Math.min(10, audioScore));

    return {
      score: audioScore,
      maxScore: 10,
      codec: aStream.codec_name,
      sampleRate: aStream.sample_rate,
      channels: aStream.channels,
      meanVolumeDb,
      maxVolumeDb,
      silentGaps,
      defects,
      hasAudio: true,
      passed: audioScore >= 7,
    };
  }
}
