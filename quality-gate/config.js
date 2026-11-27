// Quality Gate Configuration & Zero-Cost Guardrails
import { CONFIG } from '../dashboard/lib/config.js';

export const QUALITY_CONFIG = {
  enabled: CONFIG.QUALITY_GATE_ENABLED !== false,
  minScore: Number.isFinite(CONFIG.QUALITY_GATE_MIN_SCORE) ? CONFIG.QUALITY_GATE_MIN_SCORE : 85,
  maxRetries: Number.isFinite(CONFIG.QUALITY_GATE_MAX_RETRIES) ? CONFIG.QUALITY_GATE_MAX_RETRIES : 3,
  failClosed: CONFIG.QUALITY_GATE_FAIL_CLOSED !== false,
  model: CONFIG.GEMINI_QUALITY_MODEL || 'gemini-3.1-flash-lite',
  freeTierOnly: CONFIG.GEMINI_FREE_TIER_ONLY !== false,
  apiKey: CONFIG.GEMINI_API_KEY || '',
  baseUrl: CONFIG.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
  
  // Rate limiting & quotas for free-tier Gemini (15 RPM max)
  rateLimit: {
    maxRpm: 12,               // safe headroom below 15 RPM
    intervalMs: 5000,         // minimum delay between calls
    maxRetries: 3,            // retries on 429/503
    initialBackoffMs: 2000,   // initial backoff
    backoffFactor: 2,         // exponential backoff
  },

  // Scoring categories and weights (Total = 100)
  weights: {
    visualQuality: 15,
    animationQuality: 15,
    characterObjectInteractions: 15,
    scriptNarrationMatching: 15,
    storyContinuity: 10,
    cameraCinematicQuality: 5,
    voiceAudioQuality: 10,
    captionsSynchronization: 5,
    technicalIntegrity: 10,
  },

  // Score thresholds
  thresholds: {
    pass: 85,
    review: 70, // 70 - 84 is REVIEW, below 70 is FAIL
  },

  // Allowed free-tier models (Strict zero-cost enforcement: no paid models ever permitted)
  approvedFreeModels: new Set([
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash-lite',
    'gemini-flash-lite-latest',
  ]),
};

export function isModelApproved(modelName) {
  const clean = String(modelName || '').replace(/^models\//, '').trim();
  return QUALITY_CONFIG.approvedFreeModels.has(clean);
}

export function assertZeroCostCompliance(modelName) {
  if (QUALITY_CONFIG.freeTierOnly && !isModelApproved(modelName)) {
    throw new Error(
      `Zero-Cost Enforcement Violation: Model "${modelName}" is not in the approved free-tier model whitelist. Paid models are strictly forbidden.`
    );
  }
}
