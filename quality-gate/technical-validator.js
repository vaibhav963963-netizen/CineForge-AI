// Technical Video Validator (FFprobe & File Integrity)
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PATHS } from '../dashboard/lib/workspace.js';

export class TechnicalValidator {
  constructor(options = {}) {
    this.ffprobePath = options.ffprobePath || PATHS.ffprobe;
    this.expectedWidth = options.expectedWidth || 1080;
    this.expectedHeight = options.expectedHeight || 1920;
    this.expectedFps = options.expectedFps || 30;
  }

  calculateSha256(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  validate(videoPath, targetSeconds = 40, tolerance = 0.15) {
    if (!fs.existsSync(videoPath)) {
      return {
        passed: false,
        score: 0,
        maxScore: 10,
        sha256: null,
        mandatoryFailed: ['mp4_exists'],
        checks: { mp4_exists: false },
        metrics: {},
        defects: [
          {
            timestamp: 0,
            category: 'technicalIntegrity',
            type: 'file_not_found',
            severity: 'critical',
            description: `Rendered MP4 file does not exist at ${videoPath}`,
          },
        ],
      };
    }

    const sha256 = this.calculateSha256(videoPath);
    const sizeBytes = fs.statSync(videoPath).size;

    // ffprobe streams and format
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,duration',
      '-show_entries', 'format=duration,size,bit_rate',
      '-of', 'json',
      videoPath,
    ];

    const probe = spawnSync(this.ffprobePath, args, { encoding: 'utf8', windowsHide: true });
    if (probe.status !== 0) {
      return {
        passed: false,
        score: 0,
        maxScore: 10,
        sha256,
        mandatoryFailed: ['mp4_readable'],
        checks: { mp4_readable: false },
        metrics: { sizeBytes },
        defects: [
          {
            timestamp: 0,
            category: 'technicalIntegrity',
            type: 'corrupted_video',
            severity: 'critical',
            description: `FFprobe failed to decode MP4 file: ${probe.stderr || 'Corrupted file'}`,
          },
        ],
      };
    }

    let parsed = {};
    try {
      parsed = JSON.parse(probe.stdout);
    } catch {
      return {
        passed: false,
        score: 0,
        maxScore: 10,
        sha256,
        mandatoryFailed: ['mp4_readable'],
        checks: { mp4_readable: false },
        metrics: { sizeBytes },
        defects: [
          {
            timestamp: 0,
            category: 'technicalIntegrity',
            type: 'invalid_json_probe',
            severity: 'critical',
            description: 'Could not parse FFprobe output.',
          },
        ],
      };
    }

    const vStream = parsed.streams?.find((s) => s.codec_type === 'video');
    const aStream = parsed.streams?.find((s) => s.codec_type === 'audio');
    const duration = parseFloat(parsed.format?.duration || 0);

    let fps = 0;
    if (vStream?.r_frame_rate) {
      const parts = vStream.r_frame_rate.split('/').map(Number);
      fps = parts[1] ? parts[0] / parts[1] : parts[0];
    }

    const checks = {
      mp4_exists: true,
      mp4_readable: Boolean(vStream),
      resolution_1080x1920:
        vStream?.width === this.expectedWidth && vStream?.height === this.expectedHeight,
      fps_matches: Math.abs(fps - this.expectedFps) < 0.2,
      video_h264: vStream?.codec_name === 'h264',
      audio_stream_present: Boolean(aStream),
      duration_valid: duration >= 10.0,
      duration_within_tolerance:
        targetSeconds > 0 ? Math.abs(duration - targetSeconds) <= targetSeconds * tolerance : true,
    };

    const mandatory = [
      'mp4_exists',
      'mp4_readable',
      'resolution_1080x1920',
      'fps_matches',
      'audio_stream_present',
      'duration_valid',
    ];

    const mandatoryFailed = mandatory.filter((k) => !checks[k]);
    const defects = [];

    if (!checks.resolution_1080x1920) {
      defects.push({
        timestamp: 0,
        category: 'technicalIntegrity',
        type: 'invalid_resolution',
        severity: 'critical',
        description: `Resolution ${vStream?.width || 0}x${vStream?.height || 0} does not match required ${this.expectedWidth}x${this.expectedHeight} (9:16 vertical).`,
      });
    }

    if (!checks.fps_matches) {
      defects.push({
        timestamp: 0,
        category: 'technicalIntegrity',
        type: 'invalid_framerate',
        severity: 'critical',
        description: `Frame rate ${fps.toFixed(2)} fps does not match target ${this.expectedFps} fps.`,
      });
    }

    if (!checks.audio_stream_present) {
      defects.push({
        timestamp: 0,
        category: 'technicalIntegrity',
        type: 'missing_audio',
        severity: 'critical',
        description: 'Video file lacks a valid audio stream.',
      });
    }

    if (!checks.duration_valid) {
      defects.push({
        timestamp: 0,
        category: 'technicalIntegrity',
        type: 'invalid_duration',
        severity: 'critical',
        description: `Video duration ${duration.toFixed(2)}s is too short (minimum 10s).`,
      });
    }

    const passed = mandatoryFailed.length === 0;
    const score = passed ? 10 : 0;

    return {
      passed,
      score,
      maxScore: 10,
      sha256,
      mandatoryFailed,
      checks,
      metrics: {
        width: vStream?.width,
        height: vStream?.height,
        fps: Math.round(fps * 100) / 100,
        videoCodec: vStream?.codec_name,
        audioCodec: aStream?.codec_name,
        duration: Math.round(duration * 100) / 100,
        sizeMB: Math.round((sizeBytes / (1024 * 1024)) * 100) / 100,
      },
      defects,
    };
  }
}
