// Caption & Subtitle Quality Inspector
import fs from 'node:fs';

export class CaptionInspector {
  constructor(options = {}) {
    this.maxCharsPerLine = options.maxCharsPerLine || 45;
  }

  /**
   * Inspect captions (SRT, lines.json, or words.json).
   */
  inspectCaptions(srtPath, linesPath, wordsPath) {
    const defects = [];
    let cues = [];

    // Parse SRT if available
    if (srtPath && fs.existsSync(srtPath)) {
      const srtText = fs.readFileSync(srtPath, 'utf8');
      cues = this.parseSrt(srtText);
    } else if (linesPath && fs.existsSync(linesPath)) {
      try {
        const linesData = JSON.parse(fs.readFileSync(linesPath, 'utf8'));
        const rawLines = Array.isArray(linesData) ? linesData : linesData.lines || [];
        cues = rawLines.map((l, i) => ({
          index: i + 1,
          start: l.start || 0,
          end: l.end || (l.start || 0) + 2,
          text: l.text || '',
        }));
      } catch {}
    }

    if (cues.length === 0) {
      defects.push({
        timestamp: 0,
        category: 'captionsSynchronization',
        type: 'missing_captions',
        severity: 'warning',
        description: 'No subtitle track or caption file found for this video.',
        evidence: 'cues array is empty',
      });
      return {
        score: 2,
        maxScore: 5,
        cuesCount: 0,
        defects,
        passed: false,
      };
    }

    let prevEnd = 0;
    for (const cue of cues) {
      // 1. Monotonic timing
      if (cue.start < prevEnd - 0.1) {
        defects.push({
          timestamp: cue.start,
          category: 'captionsSynchronization',
          type: 'overlapping_caption_timing',
          severity: 'warning',
          description: `Caption #${cue.index} starts at ${cue.start.toFixed(2)}s before previous ends at ${prevEnd.toFixed(2)}s.`,
          evidence: `start: ${cue.start}, prevEnd: ${prevEnd}`,
        });
      }
      prevEnd = cue.end;

      // 2. Line length / overflow
      const lines = cue.text.split('\n');
      for (const line of lines) {
        if (line.length > this.maxCharsPerLine) {
          defects.push({
            timestamp: cue.start,
            category: 'captionsSynchronization',
            type: 'caption_line_overflow',
            severity: 'warning',
            description: `Caption text exceeds ${this.maxCharsPerLine} chars ("${line.slice(0, 30)}..."). Potential screen overflow.`,
            evidence: `length: ${line.length}`,
          });
        }
      }

      // 3. Very short or zero duration
      if (cue.end - cue.start < 0.2) {
        defects.push({
          timestamp: cue.start,
          category: 'captionsSynchronization',
          type: 'flash_caption_duration',
          severity: 'warning',
          description: `Caption #${cue.index} duration is extremely short (${(cue.end - cue.start).toFixed(2)}s), unreadable for viewers.`,
          evidence: `duration: ${(cue.end - cue.start).toFixed(2)}s`,
        });
      }
    }

    let score = 5;
    score -= defects.length * 1.5;
    score = Math.max(0, Math.min(5, Math.round(score)));

    return {
      score,
      maxScore: 5,
      cuesCount: cues.length,
      defects,
      passed: score >= 4,
    };
  }

  parseSrt(text) {
    const blocks = text.trim().split(/\r?\n\r?\n/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      if (lines.length >= 2) {
        const timeMatch = lines[1].match(
          /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
        );
        if (timeMatch) {
          const start =
            +timeMatch[1] * 3600 + +timeMatch[2] * 60 + +timeMatch[3] + +timeMatch[4] / 1000;
          const end =
            +timeMatch[5] * 3600 + +timeMatch[6] * 60 + +timeMatch[7] + +timeMatch[8] / 1000;
          cues.push({
            index: parseInt(lines[0], 10) || cues.length + 1,
            start,
            end,
            text: lines.slice(2).join('\n'),
          });
        }
      }
    }
    return cues;
  }
}
