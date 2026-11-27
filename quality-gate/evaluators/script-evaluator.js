// Script & Narration Evaluator
export class ScriptEvaluator {
  constructor(options = {}) {
    this.modelManager = options.modelManager;
  }

  evaluateScript(script, storyboard) {
    const defects = [];
    let score = 15;

    if (!script || !script.lines || script.lines.length === 0) {
      defects.push({
        timestamp: 0,
        category: 'scriptNarrationMatching',
        type: 'missing_script_lines',
        severity: 'critical',
        description: 'Script contains no lines.',
      });
      return { score: 0, defects, passed: false };
    }

    if (storyboard?.validation && !storyboard.validation.ok) {
      for (const f of storyboard.validation.shots || []) {
        if (!f.ok) {
          defects.push({
            sceneId: f.id,
            timestamp: f.start || 0,
            category: 'scriptNarrationMatching',
            type: 'storyboard_validation_issue',
            severity: 'warning',
            description: `Shot ${f.id} does not match its script line: ${f.issues?.join('; ') || 'unspecified mismatch'}`,
          });
          score -= 1.5;
        }
      }
    }

    score = Math.max(0, Math.min(15, Math.round(score)));
    return {
      score,
      defects,
      passed: score >= 11,
    };
  }
}
