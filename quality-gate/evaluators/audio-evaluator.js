// Audio Evaluator wrapper
export class AudioEvaluator {
  constructor(options = {}) {
    this.audioInspector = options.audioInspector;
  }

  evaluateAudio(videoPath, expectedDuration, narrationSeconds) {
    if (!this.audioInspector) {
      return { score: 10, defects: [], passed: true };
    }
    const res = this.audioInspector.inspectAudio(videoPath, expectedDuration, narrationSeconds);
    return {
      score: res.score,
      defects: res.defects,
      passed: res.passed,
      meanVolumeDb: res.meanVolumeDb,
      hasAudio: res.hasAudio,
    };
  }
}
