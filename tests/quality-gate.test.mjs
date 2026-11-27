// Comprehensive Automated Test Suite for AI Video Quality Inspector & Automatic Correction Engine
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  getQualityInspector,
  getPublishingGuard,
  getCorrectionEngine,
  VideoInspector,
  PublishingGuard,
  CorrectionEngine,
  ScoringEngine,
  TechnicalValidator,
  AudioInspector,
  CaptionInspector,
  MotionAnalyzer,
  InteractionAnalyzer,
  SceneMatcher,
  ModelManager,
  QUALITY_CONFIG,
  isModelApproved,
  assertZeroCostCompliance,
} from '../quality-gate/index.js';
import { ROOT } from '../dashboard/lib/config.js';

const SAMPLE_PROJECT = path.join(ROOT, 'projects', 'how-dinosaurs-became-extinct-science-7db92a');
const SAMPLE_MP4 = path.join(SAMPLE_PROJECT, 'renders', 'how-dinosaurs-became-extinct-science-7db92a.mp4');

test('1 · Zero-Cost & Model Enforcement: gemini-3.1-flash-lite whitelist & paid model rejection', () => {
  assert.equal(isModelApproved('gemini-3.1-flash-lite'), true);
  assert.equal(isModelApproved('gemini-3.1-flash-lite-preview'), true);
  assert.equal(isModelApproved('gemini-2.5-flash-lite'), true);
  assert.equal(isModelApproved('gemini-1.5-pro'), false);
  assert.equal(isModelApproved('gpt-4o'), false);
  assert.equal(isModelApproved('claude-3-opus'), false);

  assert.throws(
    () => assertZeroCostCompliance('gemini-pro-paid'),
    /Zero-Cost Enforcement Violation/
  );
});

test('2 · ModelManager safe status does not leak API keys in diagnostics or dashboard', () => {
  const mm = new ModelManager({ apiKey: 'AIzaSySecretTestKey123456789' });
  const status = mm.getSafeStatus();
  assert.equal(status.model, 'gemini-3.1-flash-lite');
  assert.equal(status.hasKey, true);
  assert.equal(JSON.stringify(status).includes('AIzaSySecretTestKey123456789'), false);
});

test('3 · Level 1 TechnicalValidator: Real rendered MP4 passes technical checks', () => {
  if (!fs.existsSync(SAMPLE_MP4)) return;
  const tv = new TechnicalValidator();
  const res = tv.validate(SAMPLE_MP4, 50, 0.2);
  assert.equal(res.passed, true);
  assert.equal(res.score, 10);
  assert.equal(res.checks.resolution_1080x1920, true);
  assert.equal(res.checks.fps_matches, true);
  assert.equal(res.checks.audio_stream_present, true);
  assert.ok(res.sha256 && res.sha256.length === 64);
});

test('4 · Level 1 TechnicalValidator: Corrupted or missing MP4 output strictly fails', () => {
  const tv = new TechnicalValidator();
  const res = tv.validate('non_existent_video.mp4', 40, 0.15);
  assert.equal(res.passed, false);
  assert.equal(res.score, 0);
  assert.ok(res.mandatoryFailed.includes('mp4_exists'));
});

test('5 · Level 1 TechnicalValidator: Invalid resolution is flagged as critical defect', () => {
  const tv = new TechnicalValidator({ expectedWidth: 3840, expectedHeight: 2160 }); // Expect 4K
  if (!fs.existsSync(SAMPLE_MP4)) return;
  const res = tv.validate(SAMPLE_MP4, 50, 0.2);
  assert.equal(res.passed, false);
  assert.ok(res.mandatoryFailed.includes('resolution_1080x1920'));
  assert.ok(res.defects.some((d) => d.type === 'invalid_resolution'));
});

test('6 · Level 2 & 3 MotionAnalyzer: Detects frozen animation and static intervals', () => {
  if (!fs.existsSync(SAMPLE_MP4)) return;
  const ma = new MotionAnalyzer({ maxStaticSec: 1.5 });
  const res = ma.analyzeMotion(SAMPLE_MP4);
  assert.ok(typeof res.score === 'number');
  assert.ok(Array.isArray(res.freezes));
  assert.ok(Array.isArray(res.blackGaps));
  assert.ok(typeof res.avgMotion === 'number');
});

test('7 · Level 4 InteractionAnalyzer: Detects expected interactions from narration', () => {
  const ia = new InteractionAnalyzer();
  const keywordsOpen = ia.detectExpectedInteractions({}, 'The astronaut opens the airlock door.');
  assert.ok(keywordsOpen.includes('open_close'));

  const keywordsPickup = ia.detectExpectedInteractions({}, 'She picks up the metallic sample.');
  assert.ok(keywordsPickup.includes('pickup_hold'));

  const keywordsTalk = ia.detectExpectedInteractions({}, 'Two engineers talk about the spacecraft engine.');
  assert.ok(keywordsTalk.includes('character_dialogue'));

  const keywordsNone = ia.detectExpectedInteractions({}, 'A scenic vista of red dust stretches into the distance.');
  assert.equal(keywordsNone.length, 0);
});

test('8 · Level 4 SceneMatcher: Identifies narrative mismatches', async () => {
  // Mock model manager returning mismatch
  const mockMM = {
    model: 'gemini-3.1-flash-lite',
    quotaExhausted: false,
    async generateContent() {
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    score: 4,
                    matches_narration: false,
                    defects: [
                      {
                        timestamp: 5.0,
                        severity: 'critical',
                        description: 'Modern city shown while narration talks about prehistoric dinosaurs.',
                      },
                    ],
                    reasoning: 'Visual mismatch between dinosaurs and modern city.',
                  }),
                },
              ],
            },
          },
        ],
      };
    },
  };

  const sm = new SceneMatcher({
    modelManager: mockMM,
    frameExtractor: {
      sampleSceneFrames: () => [{ path: 'dummy.jpg', timestamp: 5.0 }],
      toBase64: () => 'dummy_base64',
    },
  });

  const res = await sm.matchScene('dummy.mp4', { id: 'S01', start: 0, end: 10 }, 'Dinosaurs roamed the Earth', 'dummy_dir');
  assert.equal(res.matches, false);
  assert.equal(res.score, 4);
  assert.equal(res.defects[0].type, 'narration_mismatch');
  assert.equal(res.defects[0].severity, 'critical');
});

test('9 · AudioInspector: Audio stream validation & silence detection', () => {
  if (!fs.existsSync(SAMPLE_MP4)) return;
  const ai = new AudioInspector();
  const res = ai.inspectAudio(SAMPLE_MP4, 50, 50);
  assert.equal(res.hasAudio, true);
  assert.equal(res.codec, 'aac');
  assert.ok(typeof res.meanVolumeDb === 'number');
  assert.ok(res.score > 0);
});

test('10 · AudioInspector: Missing audio track triggers critical failure', () => {
  const videoOnlyMp4 = path.join(SAMPLE_PROJECT, 'renders', 'video-only.mp4');
  if (!fs.existsSync(videoOnlyMp4)) return;
  const ai = new AudioInspector();
  const res = ai.inspectAudio(videoOnlyMp4, 40, 40);
  assert.equal(res.hasAudio, false);
  assert.equal(res.score, 0);
  assert.equal(res.defects[0].severity, 'critical');
  assert.equal(res.defects[0].type, 'missing_audio_stream');
});

test('11 · CaptionInspector: Detects screen overflow and overlapping timing', () => {
  const ci = new CaptionInspector({ maxCharsPerLine: 40 });
  const sampleSrt = `1
00:00:01,000 --> 00:00:04,000
This is a very long line of caption text that easily exceeds forty characters and will overflow the screen.

2
00:00:03,500 --> 00:00:06,000
Overlapping start time before cue 1 finishes.
`;
  const tmpSrt = path.join(ROOT, 'review_test_captions.srt');
  fs.writeFileSync(tmpSrt, sampleSrt);
  try {
    const res = ci.inspectCaptions(tmpSrt, null, null);
    assert.equal(res.cuesCount, 2);
    assert.ok(res.defects.some((d) => d.type === 'caption_line_overflow'));
    assert.ok(res.defects.some((d) => d.type === 'overlapping_caption_timing'));
    assert.ok(res.score < 5);
  } finally {
    fs.rmSync(tmpSrt, { force: true });
  }
});

test('12 · ScoringEngine: High-quality score >= 85 produces PASS and allows publishing', () => {
  const se = new ScoringEngine({ minScore: 85 });
  const res = se.calculateQualityScore({
    categoryScores: {
      visualQuality: 14,
      animationQuality: 14,
      characterObjectInteractions: 14,
      scriptNarrationMatching: 14,
      storyContinuity: 9,
      cameraCinematicQuality: 5,
      voiceAudioQuality: 9,
      captionsSynchronization: 5,
      technicalIntegrity: 10,
    },
  });
  assert.equal(res.overallScore, 94);
  assert.equal(res.status, 'PASS');
  assert.equal(res.publishAllowed, true);
});

test('13 · ScoringEngine: Score 70-84 produces REVIEW and blocks publishing', () => {
  const se = new ScoringEngine({ minScore: 85 });
  const res = se.calculateQualityScore({
    categoryScores: {
      visualQuality: 11,
      animationQuality: 11,
      characterObjectInteractions: 11,
      scriptNarrationMatching: 11,
      storyContinuity: 8,
      cameraCinematicQuality: 4,
      voiceAudioQuality: 8,
      captionsSynchronization: 4,
      technicalIntegrity: 10,
    },
  });
  assert.equal(res.overallScore, 78);
  assert.equal(res.status, 'REVIEW');
  assert.equal(res.publishAllowed, false);
});

test('14 · ScoringEngine: Critical defect strictly forces FAILED and overrides score', () => {
  const se = new ScoringEngine({ minScore: 85 });
  const res = se.calculateQualityScore({
    categoryScores: {
      visualQuality: 15,
      animationQuality: 15,
      characterObjectInteractions: 15,
      scriptNarrationMatching: 15,
      storyContinuity: 10,
      cameraCinematicQuality: 5,
      voiceAudioQuality: 10,
      captionsSynchronization: 5,
      technicalIntegrity: 10,
    },
    criticalDefects: [
      {
        timestamp: 12.0,
        severity: 'critical',
        description: 'Complete narration silence during dialogue scene.',
      },
    ],
  });
  assert.equal(res.status, 'FAILED');
  assert.equal(res.publishAllowed, false);
  assert.ok(res.reasons.some((r) => r.includes('Critical defects detected')));
});

test('15 · ScoringEngine: Quota exhaustion marks BLOCKED_BY_QUOTA and enforces zero-cost safe pause', () => {
  const se = new ScoringEngine();
  const res = se.calculateQualityScore({
    categoryScores: { visualQuality: 15 },
    quotaExhausted: true,
  });
  assert.equal(res.status, 'BLOCKED_BY_QUOTA');
  assert.equal(res.publishAllowed, false);
  assert.ok(res.reasons.some((r) => r.includes('quota exhausted')));
});

test('16 · PublishingGuard: Permits publishing only for PASS status with matching hash', () => {
  if (!fs.existsSync(SAMPLE_MP4)) return;
  const pg = new PublishingGuard({ minScore: 85 });
  const currentHash = crypto.createHash('sha256').update(fs.readFileSync(SAMPLE_MP4)).digest('hex');

  const validReport = {
    status: 'PASS',
    overallScore: 92,
    videoSha256: currentHash,
    defects: [],
    technicalReport: { mandatoryFailed: [] },
  };

  const res = pg.assertPublishable({ videoPath: SAMPLE_MP4, qualityReport: validReport });
  assert.equal(res.allowed, true);
});

test('17 · PublishingGuard: Uninspected video is strictly blocked from publishing', () => {
  if (!fs.existsSync(SAMPLE_MP4)) return;
  const pg = new PublishingGuard();
  assert.throws(
    () => pg.assertPublishable({ videoPath: SAMPLE_MP4, qualityReport: null }),
    (err) => err.code === 'PUBLISH_BLOCKED' && err.reason === 'UNINSPECTED'
  );
});

test('18 · PublishingGuard: Video changed after inspection (hash mismatch) is blocked', () => {
  if (!fs.existsSync(SAMPLE_MP4)) return;
  const pg = new PublishingGuard();
  const oldHash = '0000000000000000000000000000000000000000000000000000000000000000';

  const report = {
    status: 'PASS',
    overallScore: 95,
    videoSha256: oldHash,
    defects: [],
    technicalReport: { mandatoryFailed: [] },
  };

  assert.throws(
    () => pg.assertPublishable({ videoPath: SAMPLE_MP4, qualityReport: report }),
    (err) => err.code === 'PUBLISH_BLOCKED' && err.reason === 'HASH_MISMATCH'
  );
});

test('19 · CorrectionEngine: Generates targeted scene correction instructions', () => {
  const ce = new CorrectionEngine({ maxRetries: 3 });
  const mockReport = {
    projectId: 'test-project',
    overallScore: 72,
    status: 'REVIEW',
    retryCount: 0,
    scenes: [
      {
        sceneId: 'S02',
        timestampStart: 4.5,
        timestampEnd: 8.0,
        narration: 'The astronaut opens the spaceship door.',
        intendedAction: 'Static astronaut standing beside door',
        passed: false,
        defects: [
          {
            timestamp: 4.5,
            type: 'incomplete_interaction',
            severity: 'critical',
            description: 'Action was incomplete: astronaut remained static and door did not open.',
          },
        ],
      },
    ],
  };

  const plan = ce.generateCorrectionPlan(mockReport, SAMPLE_PROJECT);
  assert.equal(plan.canRetry, true);
  assert.equal(plan.failedScenesCount, 1);
  assert.equal(plan.instructions[0].sceneId, 'S02');
  assert.ok(plan.instructions[0].instruction.includes('astronaut opens the spaceship door') || plan.instructions[0].instruction.includes('S02'));
});

test('20 · CorrectionEngine: Respects maximum retry limit (3 retries max)', () => {
  const ce = new CorrectionEngine({ maxRetries: 3 });
  const exhaustedReport = {
    projectId: 'test-project',
    overallScore: 65,
    status: 'FAILED',
    retryCount: 3, // Already reached 3 retries
    scenes: [{ sceneId: 'S01', passed: false, defects: [{ severity: 'critical' }] }],
  };

  const plan = ce.generateCorrectionPlan(exhaustedReport, SAMPLE_PROJECT);
  assert.equal(plan.canRetry, false);
});
