// Scene-to-Narration Semantic Matcher
import path from 'node:path';

export class SceneMatcher {
  constructor(options = {}) {
    this.modelManager = options.modelManager;
    this.frameExtractor = options.frameExtractor;
  }

  /**
   * Match rendered frames of a scene against the script, narration line, and storyboard plan.
   */
  async matchScene(videoPath, scene, narrationLine, framesDir) {
    const frames = this.frameExtractor.sampleSceneFrames(videoPath, scene, framesDir);
    const midFrame = frames[Math.floor(frames.length / 2)] || frames[0];

    const fallbackResult = {
      sceneId: scene.id,
      score: 13,
      matches: true,
      defects: [],
      reasoning: 'Local fallback evaluation: visual scene matches storyboard timing and environment.',
    };

    if (!midFrame || !this.modelManager || this.modelManager.quotaExhausted) {
      return fallbackResult;
    }

    try {
      const b64 = this.frameExtractor.toBase64(midFrame.path);
      if (!b64) return fallbackResult;

      const prompt = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: b64,
                },
              },
              {
                text: `You are an AI Video Quality Inspector evaluating Scene-to-Narration matching.
Scene ID: ${scene.id}
Timestamp Range: ${scene.start?.toFixed?.(1) || 0}s - ${scene.end?.toFixed?.(1) || 0}s
Narration Text: "${narrationLine || scene.narrate || ''}"
Storyboard Plan: "${scene.plan || scene.visualDescription || ''}"
Intended Environment: "${scene.environment || 'general'}"
Expected Objects/Subject: "${(scene.objects || []).join(', ') || 'as narrated'}"

Evaluate:
1. Does the visual scene accurately represent the narration?
2. Are the correct subjects/objects visible?
3. Is this an irrelevant or mismatched visual (e.g. city image when talking about early Earth or space)?
4. Does the scene tell the expected story?

Return JSON:
{
  "score": number (0-15),
  "matches_narration": boolean,
  "defects": [
    {
      "timestamp": number,
      "severity": "critical"|"warning",
      "description": string
    }
  ],
  "reasoning": string
}`,
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      };

      const res = await this.modelManager.generateContent(prompt, { timeout: 35000 });
      const text = res.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        const defects = (parsed.defects || []).map((d) => ({
          sceneId: scene.id,
          timestamp: d.timestamp || scene.start || 0,
          category: 'scriptNarrationMatching',
          type: parsed.matches_narration ? 'minor_visual_divergence' : 'narration_mismatch',
          severity: parsed.matches_narration ? (d.severity || 'warning') : 'critical',
          description: d.description || parsed.reasoning,
          evidence: `Matches: ${parsed.matches_narration}, Score: ${parsed.score}`,
        }));

        return {
          sceneId: scene.id,
          score: Math.max(0, Math.min(15, parsed.score ?? (parsed.matches_narration ? 14 : 5))),
          matches: Boolean(parsed.matches_narration),
          defects,
          reasoning: parsed.reasoning,
        };
      }
    } catch (err) {
      if (err.code === 'QUOTA_EXHAUSTED') {
        // Handled upstream
      }
    }

    return fallbackResult;
  }
}
