// Quality Report Generator & Persistence
import fs from 'node:fs';
import path from 'node:path';

export class ReportGenerator {
  constructor(options = {}) {
    this.outputDir = options.outputDir;
  }

  generateReport({
    projectId,
    videoPath,
    videoSha256,
    modelId,
    modelAvailable = true,
    scoreResult,
    defects = [],
    sceneReports = [],
    technicalReport = {},
    audioReport = {},
    captionReport = {},
    motionReport = {},
    correctionHistory = [],
    retryCount = 0,
  }) {
    const report = {
      version: '1.0.0',
      projectId,
      videoPath,
      videoSha256,
      inspectedAt: new Date().toISOString(),
      modelId,
      modelAvailable,
      overallScore: scoreResult.overallScore,
      status: scoreResult.status,
      publishAllowed: scoreResult.publishAllowed,
      reasons: scoreResult.reasons || [],
      categoryScores: scoreResult.categoryScores,
      defects,
      scenes: sceneReports,
      technicalReport,
      audioReport,
      captionReport,
      motionReport,
      correctionHistory,
      retryCount,
    };

    return report;
  }

  saveReport(report, targetDir) {
    if (!targetDir) return null;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const reportFile = path.join(targetDir, 'quality_report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');

    // Also write qa_report.json for backwards compatibility with existing studio readers
    const compatFile = path.join(targetDir, 'qa_report.json');
    try {
      const compat = {
        project: report.projectId,
        video: report.videoPath,
        status: report.status === 'PASS' ? 'PASS' : report.status === 'REVIEW' ? 'PASS_WITH_WARNINGS' : 'FAIL',
        qualityScore: report.overallScore,
        categoryScores: report.categoryScores,
        metrics: report.technicalReport?.metrics || {},
        checks: report.technicalReport?.checks || {},
        failed: report.technicalReport?.mandatoryFailed || [],
        checkedAt: report.inspectedAt,
        defects: report.defects,
        approval: {
          decision: report.publishAllowed ? 'APPROVED' : report.status === 'REVIEW' ? 'NEEDS_REVIEW' : 'REJECTED',
          reasons: report.reasons,
        },
      };
      fs.writeFileSync(compatFile, JSON.stringify(compat, null, 2), 'utf8');
    } catch {}

    return reportFile;
  }

  loadReport(targetDir) {
    const reportFile = path.join(targetDir, 'quality_report.json');
    if (!fs.existsSync(reportFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    } catch {
      return null;
    }
  }
}
