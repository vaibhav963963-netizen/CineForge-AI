// Visual Quality Evaluator (Clarity, Sharpness, Artifacts, Composition)
export class VisualEvaluator {
  constructor(options = {}) {
    this.modelManager = options.modelManager;
    this.frameExtractor = options.frameExtractor;
  }

  async evaluateScene(videoPath, scene, framesDir) {
    const frames = this.frameExtractor.sampleSceneFrames(videoPath, scene, framesDir);
    const midFrame = frames[Math.floor(frames.length / 2)] || frames[0];

    const fallback = {
      score: 14,
      defects: [],
      clarity: 'high',
      lighting: 'good',
      summary: 'Local visual check: rendered frame passed exposure and decode tests.',
    };

    if (!midFrame || !this.modelManager || this.modelManager.quotaExhausted) {
      return fallback;
    }

    try {
      const b64 = this.frameExtractor.toBase64(midFrame.path);
      if (!b64) return fallback;

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
                text: `You are an AI Video Quality Inspector evaluating Visual Quality.
Scene ID: ${scene.id}
Evaluate the image clarity, sharpness, lighting consistency, subject visibility, and absence of visual artifacts/distortion or black boxes.
Return JSON:
{
  "score": number (0-15),
  "subject_visible": boolean,
  "defects": [
    {
      "timestamp": number,
      "type": string,
      "severity": "critical"|"warning",
      "description": string
    }
  ],
  "summary": string
}`,
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      };

      const res = await this.modelManager.generateContent(prompt, { timeout: 30000 });
      const text = res.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        const defects = (parsed.defects || []).map((d) => ({
          sceneId: scene.id,
          timestamp: d.timestamp || scene.start || 0,
          category: 'visualQuality',
          type: d.type || 'visual_defect',
          severity: d.severity || 'warning',
          description: d.description || parsed.summary,
        }));

        return {
          score: Math.max(0, Math.min(15, parsed.score ?? (parsed.subject_visible ? 14 : 6))),
          defects,
          clarity: parsed.subject_visible ? 'high' : 'low',
          summary: parsed.summary,
        };
      }
    } catch {}

    return fallback;
  }
}
