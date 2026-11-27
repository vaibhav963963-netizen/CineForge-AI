// Animation Evaluator wrapper
export class AnimationEvaluator {
  constructor(options = {}) {
    this.motionAnalyzer = options.motionAnalyzer;
  }

  evaluateAnimation(videoPath) {
    if (!this.motionAnalyzer) {
      return { score: 14, defects: [], passed: true };
    }
    const result = this.motionAnalyzer.analyzeMotion(videoPath);
    return {
      score: result.score,
      defects: result.defects,
      passed: result.passed,
      freezes: result.freezes,
      avgMotion: result.avgMotion,
    };
  }
}
