// Quality Scoring Engine
import { QUALITY_CONFIG } from './config.js';

export class ScoringEngine {
  constructor(options = {}) {
    this.minScore = options.minScore || QUALITY_CONFIG.minScore;
    this.failClosed = options.failClosed !== false;
    this.weights = { ...QUALITY_CONFIG.weights, ...(options.weights || {}) };
  }

  calculateQualityScore({
    categoryScores,
    mandatoryFailures = [],
    criticalDefects = [],
    quotaExhausted = false,
    evalError = null,
  }) {
    // Ensure all categories exist with default maximums or provided values
    const scores = {
      visualQuality: Math.max(0, Math.min(15, categoryScores.visualQuality ?? 15)),
      animationQuality: Math.max(0, Math.min(15, categoryScores.animationQuality ?? 15)),
      characterObjectInteractions: Math.max(0, Math.min(15, categoryScores.characterObjectInteractions ?? 15)),
      scriptNarrationMatching: Math.max(0, Math.min(15, categoryScores.scriptNarrationMatching ?? 15)),
      storyContinuity: Math.max(0, Math.min(10, categoryScores.storyContinuity ?? 10)),
      cameraCinematicQuality: Math.max(0, Math.min(5, categoryScores.cameraCinematicQuality ?? 5)),
      voiceAudioQuality: Math.max(0, Math.min(10, categoryScores.voiceAudioQuality ?? 10)),
      captionsSynchronization: Math.max(0, Math.min(5, categoryScores.captionsSynchronization ?? 5)),
      technicalIntegrity: Math.max(0, Math.min(10, categoryScores.technicalIntegrity ?? 10)),
    };

    const overallScore = Object.values(scores).reduce((sum, val) => sum + val, 0);

    // Check quota or fatal system errors
    if (quotaExhausted) {
      return {
        overallScore,
        categoryScores: scores,
        status: 'BLOCKED_BY_QUOTA',
        publishAllowed: false,
        reasons: ['Gemini free-tier quota exhausted. Video inspection paused to enforce zero-cost.'],
      };
    }

    if (evalError && this.failClosed) {
      return {
        overallScore,
        categoryScores: scores,
        status: 'BLOCKED_BY_ERROR',
        publishAllowed: false,
        reasons: [`Evaluation could not complete: ${evalError.message || evalError}`],
      };
    }

    // Mandatory technical failures strictly block PASS
    const failureReasons = [];
    if (mandatoryFailures.length > 0) {
      failureReasons.push(`Mandatory technical checks failed: ${mandatoryFailures.join(', ')}`);
    }

    if (criticalDefects.length > 0) {
      failureReasons.push(
        `Critical defects detected: ${criticalDefects.map((d) => d.description || d.type).join('; ')}`
      );
    }

    let status = 'PASS';
    let publishAllowed = false;

    if (failureReasons.length > 0) {
      status = 'FAILED';
      publishAllowed = false;
    } else if (overallScore >= this.minScore) {
      status = 'PASS';
      publishAllowed = true;
    } else if (overallScore >= 70) {
      status = 'REVIEW';
      publishAllowed = false;
      failureReasons.push(
        `Score (${overallScore}) is below minimum PASS threshold (${this.minScore}). Requires review.`
      );
    } else {
      status = 'FAILED';
      publishAllowed = false;
      failureReasons.push(
        `Score (${overallScore}) is below 70. Video quality failed.`
      );
    }

    return {
      overallScore: Math.round(overallScore * 10) / 10,
      categoryScores: scores,
      status,
      publishAllowed,
      reasons: failureReasons,
    };
  }
}
