// YouTube Publishing Guard & Anti-Bypass Gate
import fs from 'node:fs';
import crypto from 'node:crypto';
import { QUALITY_CONFIG } from './config.js';

export class PublishingGuard {
  constructor(options = {}) {
    this.enabled = options.enabled ?? QUALITY_CONFIG.enabled;
    this.minScore = options.minScore || QUALITY_CONFIG.minScore;
    this.failClosed = options.failClosed !== false;
  }

  calculateSha256(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  /**
   * Asserts whether a video is strictly permitted to be uploaded or published.
   * Throws an Error with code 'PUBLISH_BLOCKED' if any criterion fails.
   */
  assertPublishable({ videoPath, qualityReport, currentRun = null }) {
    if (!this.enabled) {
      return { allowed: true, reason: 'Quality gate disabled in configuration' };
    }

    if (!videoPath || !fs.existsSync(videoPath)) {
      const err = new Error(`Publishing BLOCKED: Video file does not exist at "${videoPath}".`);
      err.code = 'PUBLISH_BLOCKED';
      err.reason = 'MISSING_FILE';
      throw err;
    }

    if (!qualityReport) {
      const err = new Error(
        `Publishing BLOCKED: Video "${videoPath}" has never completed Quality Gate inspection.`
      );
      err.code = 'PUBLISH_BLOCKED';
      err.reason = 'UNINSPECTED';
      throw err;
    }

    // 1. Status must be PASS
    if (qualityReport.status !== 'PASS') {
      const err = new Error(
        `Publishing BLOCKED: Quality Gate status is "${qualityReport.status}" (score: ${qualityReport.overallScore || 0}/${this.minScore}). Reasons: ${(qualityReport.reasons || []).join('; ')}`
      );
      err.code = 'PUBLISH_BLOCKED';
      err.status = qualityReport.status;
      err.reason = qualityReport.status;
      throw err;
    }

    // 2. Score must satisfy minimum
    if ((qualityReport.overallScore || 0) < this.minScore) {
      const err = new Error(
        `Publishing BLOCKED: Score ${qualityReport.overallScore} is below required ${this.minScore}.`
      );
      err.code = 'PUBLISH_BLOCKED';
      err.reason = 'SCORE_TOO_LOW';
      throw err;
    }

    // 3. Technical mandatory checks
    const techMandatoryFailed = qualityReport.technicalReport?.mandatoryFailed || [];
    if (techMandatoryFailed.length > 0) {
      const err = new Error(
        `Publishing BLOCKED: Mandatory technical checks failed: ${techMandatoryFailed.join(', ')}`
      );
      err.code = 'PUBLISH_BLOCKED';
      err.reason = 'TECHNICAL_FAILURE';
      throw err;
    }

    // 4. No unresolved critical defects
    const criticalDefects = (qualityReport.defects || []).filter((d) => d.severity === 'critical');
    if (criticalDefects.length > 0) {
      const err = new Error(
        `Publishing BLOCKED: Found ${criticalDefects.length} unresolved critical defect(s): ${criticalDefects.map((d) => d.description).join('; ')}`
      );
      err.code = 'PUBLISH_BLOCKED';
      err.reason = 'CRITICAL_DEFECT';
      throw err;
    }

    // 5. Video file integrity and hash verification: file must not have been tampered or changed since inspection
    const currentSha256 = this.calculateSha256(videoPath);
    if (qualityReport.videoSha256 && currentSha256 !== qualityReport.videoSha256) {
      const err = new Error(
        `Publishing BLOCKED: Video file has changed since inspection (inspected hash: ${qualityReport.videoSha256.slice(0, 10)}..., current hash: ${currentSha256.slice(0, 10)}...). Previous inspection invalidated.`
      );
      err.code = 'PUBLISH_BLOCKED';
      err.reason = 'HASH_MISMATCH';
      throw err;
    }

    return {
      allowed: true,
      score: qualityReport.overallScore,
      sha256: currentSha256,
      inspectedAt: qualityReport.inspectedAt,
    };
  }

  isPublishAllowed(report) {
    if (!report) return false;
    if (report.status !== 'PASS') return false;
    if ((report.overallScore || 0) < this.minScore) return false;
    return Boolean(report.publishAllowed);
  }
}
