// Interaction Evaluator wrapper
export class InteractionEvaluator {
  constructor(options = {}) {
    this.interactionAnalyzer = options.interactionAnalyzer;
  }

  async evaluateInteractions(videoPath, scenes, narrationLines, framesDir) {
    if (!this.interactionAnalyzer || !scenes || scenes.length === 0) {
      return { score: 14, defects: [], passed: true };
    }

    const sceneResults = [];
    const allDefects = [];
    let totalScore = 0;

    for (const [idx, sc] of scenes.entries()) {
      const line = narrationLines[idx]?.text || sc.narrate || '';
      const res = await this.interactionAnalyzer.inspectSceneInteraction(
        videoPath,
        sc,
        line,
        framesDir
      );
      sceneResults.push(res);
      allDefects.push(...res.defects);
      totalScore += res.score;
    }

    const meanScore =
      scenes.length > 0 ? Math.round(totalScore / scenes.length) : 15;

    return {
      score: Math.max(0, Math.min(15, meanScore)),
      defects: allDefects,
      sceneResults,
      passed: meanScore >= 11,
    };
  }
}
