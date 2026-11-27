// Automatic Scene Quality Correction Engine
import fs from 'node:fs';
import path from 'node:path';
import { QUALITY_CONFIG } from './config.js';

export class CorrectionEngine {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || QUALITY_CONFIG.maxRetries;
    this.videoInspector = options.videoInspector;
  }

  /**
   * Analyze an inspection report and generate targeted correction instructions.
   */
  generateCorrectionPlan(report, projectDir) {
    const failedScenes = (report.scenes || []).filter((s) => !s.passed || (s.defects && s.defects.length > 0));
    const instructions = [];

    for (const sc of failedScenes) {
      const defects = sc.defects || [];
      const criticalDefects = defects.filter((d) => d.severity === 'critical');
      const actionProblems = defects.filter((d) => d.type?.includes('interaction') || d.type?.includes('static'));
      const narrationMismatches = defects.filter((d) => d.type?.includes('mismatch'));

      let plan = `Scene ${sc.sceneId} (${(sc.timestampStart || 0).toFixed(1)}s-${(sc.timestampEnd || 0).toFixed(1)}s): `;

      if (narrationMismatches.length > 0) {
        plan += `Regenerate visual representation to match narration: "${sc.narration}". Ensure environment and subjects align with script context.`;
      } else if (actionProblems.length > 0) {
        plan += `Action was incomplete or static. Modify scene storyboard action from "${sc.intendedAction}" to a full visual progression: subject approaches, performs action visibly, and completes movement.`;
      } else if (criticalDefects.length > 0) {
        plan += `Resolve visual defect: ${criticalDefects.map((d) => d.description).join('; ')}.`;
      } else {
        plan += `Refine prompt and lighting consistency for narration: "${sc.narration}".`;
      }

      instructions.push({
        sceneId: sc.sceneId,
        timestamp: sc.timestampStart,
        instruction: plan,
        defects,
      });
    }

    return {
      projectId: report.projectId,
      attemptNumber: (report.retryCount || 0) + 1,
      canRetry: (report.retryCount || 0) < this.maxRetries,
      failedScenesCount: failedScenes.length,
      instructions,
    };
  }

  /**
   * Apply automatic correction to the project storyboard / scene definitions.
   * Modifies only the affected scenes, preserving passed scenes.
   */
  async applyCorrection(projectDir, correctionPlan) {
    if (!correctionPlan.canRetry) {
      return {
        success: false,
        reason: `Exceeded maximum correction retries (${this.maxRetries}). Marking as FAILED.`,
      };
    }

    const sbFile = path.join(projectDir, 'storyboard', 'storyboard.json');
    if (!fs.existsSync(sbFile)) {
      return { success: false, reason: 'storyboard.json not found' };
    }

    let storyboard;
    try {
      storyboard = JSON.parse(fs.readFileSync(sbFile, 'utf8'));
    } catch (e) {
      return { success: false, reason: `Could not parse storyboard.json: ${e.message}` };
    }

    const modifiedScenes = [];
    for (const item of correctionPlan.instructions) {
      const shot = (storyboard.shots || []).find((s) => s.id === item.sceneId);
      if (shot) {
        // Update prompt with enhanced action details and rim lighting
        if (shot.imagePrompt && !shot.imagePrompt.includes('dramatic rim light')) {
          shot.imagePrompt += ', dynamic visual composition, clear subject visibility, dramatic cinematic lighting';
        }
        if (shot.action) {
          shot.action = `Visibly active: ${shot.action}, continuous motion, clear gesture`;
        }
        shot.corrected = true;
        shot.correctionInstruction = item.instruction;
        modifiedScenes.push(item.sceneId);
      }
    }

    // Save updated storyboard
    fs.writeFileSync(sbFile, JSON.stringify(storyboard, null, 2), 'utf8');

    return {
      success: true,
      modifiedScenes,
      instructions: correctionPlan.instructions.map((i) => i.instruction),
      attempt: correctionPlan.attemptNumber,
    };
  }

  /**
   * Full correction loop: inspect -> plan -> apply -> re-inspect
   */
  async runCorrectionCycle(projectDir, initialReport, renderCallback = null) {
    let currentReport = initialReport;
    let attempt = currentReport.retryCount || 0;
    const history = currentReport.correctionHistory || [];

    while (currentReport.status !== 'PASS' && attempt < this.maxRetries) {
      attempt++;
      const plan = this.generateCorrectionPlan(currentReport, projectDir);
      if (!plan.canRetry) break;

      const applied = await this.applyCorrection(projectDir, plan);
      if (!applied.success) break;

      // If a re-render callback is provided (e.g. rebuild scene frames or re-mux), run it
      if (typeof renderCallback === 'function') {
        try {
          await renderCallback(applied);
        } catch {}
      }

      // Re-run quality inspection
      currentReport = await this.videoInspector.inspectProject(projectDir, {
        retryCount: attempt,
      });

      history.push({
        attempt,
        timestamp: new Date().toISOString(),
        instructions: applied.instructions,
        repairedScenes: applied.modifiedScenes,
        outcomeScore: currentReport.overallScore,
        outcomeStatus: currentReport.status,
      });

      currentReport.correctionHistory = history;
      currentReport.retryCount = attempt;
    }

    return currentReport;
  }
}
