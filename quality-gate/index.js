// CineForge AI Video Quality Inspector & Automatic Correction Engine
// Root Export & Public API

export { QUALITY_CONFIG, isModelApproved, assertZeroCostCompliance } from './config.js';
export { ModelManager } from './model-manager.js';
export { FrameExtractor } from './frame-extractor.js';
export { MotionAnalyzer } from './motion-analyzer.js';
export { InteractionAnalyzer } from './interaction-analyzer.js';
export { SceneMatcher } from './scene-matcher.js';
export { AudioInspector } from './audio-inspector.js';
export { CaptionInspector } from './caption-inspector.js';
export { TechnicalValidator } from './technical-validator.js';
export { ScoringEngine } from './scoring-engine.js';
export { CorrectionEngine } from './correction-engine.js';
export { PublishingGuard } from './publishing-guard.js';
export { ReportGenerator } from './report-generator.js';
export { VideoInspector } from './video-inspector.js';

import { VideoInspector } from './video-inspector.js';
import { PublishingGuard } from './publishing-guard.js';
import { CorrectionEngine } from './correction-engine.js';

let defaultInspector = null;
let defaultGuard = null;
let defaultCorrection = null;

export function getQualityInspector(options = {}) {
  if (!defaultInspector || Object.keys(options).length > 0) {
    defaultInspector = new VideoInspector(options);
  }
  return defaultInspector;
}

export function getPublishingGuard(options = {}) {
  if (!defaultGuard || Object.keys(options).length > 0) {
    defaultGuard = new PublishingGuard(options);
  }
  return defaultGuard;
}

export function getCorrectionEngine(options = {}) {
  if (!defaultCorrection || Object.keys(options).length > 0) {
    defaultCorrection = new CorrectionEngine({
      videoInspector: getQualityInspector(options),
      ...options,
    });
  }
  return defaultCorrection;
}

/**
 * Convenient one-line inspector for a project or video path.
 */
export async function inspectVideo(videoPath, options = {}) {
  const inspector = getQualityInspector(options);
  return inspector.inspectVideo(videoPath, options);
}

export async function inspectProject(projectDir, options = {}) {
  const inspector = getQualityInspector(options);
  return inspector.inspectProject(projectDir, options);
}

/**
 * Convenient one-line publishing guard check. Throws if publishing is blocked.
 */
export function assertPublishable({ videoPath, qualityReport, currentRun = null }) {
  const guard = getPublishingGuard();
  return guard.assertPublishable({ videoPath, qualityReport, currentRun });
}
