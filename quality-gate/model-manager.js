// Model Manager for Gemini Free-Tier Multimodal Evaluation
import { QUALITY_CONFIG, isModelApproved, assertZeroCostCompliance } from './config.js';

export class ModelManager {
  constructor(options = {}) {
    this.apiKey = options.apiKey || QUALITY_CONFIG.apiKey;
    this.model = options.model || QUALITY_CONFIG.model;
    this.baseUrl = options.baseUrl || QUALITY_CONFIG.baseUrl;
    this.rateLimit = { ...QUALITY_CONFIG.rateLimit, ...options.rateLimit };
    this.lastRequestTime = 0;
    this.quotaExhausted = false;
    this.quotaResetTime = null;
    this.lastError = null;

    assertZeroCostCompliance(this.model);
  }

  getSafeStatus() {
    return {
      model: this.model,
      approved: isModelApproved(this.model),
      freeTierOnly: QUALITY_CONFIG.freeTierOnly,
      hasKey: Boolean(this.apiKey),
      quotaExhausted: this.quotaExhausted,
      quotaResetTime: this.quotaResetTime,
      lastError: this.lastError ? this.lastError.message : null,
    };
  }

  async throttle() {
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.rateLimit.intervalMs) {
      const waitMs = this.rateLimit.intervalMs - timeSinceLast;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestTime = Date.now();
  }

  async verifyModelAvailability() {
    if (!this.apiKey) {
      return { available: false, error: 'GEMINI_API_KEY is not configured' };
    }
    assertZeroCostCompliance(this.model);

    try {
      const url = `${this.baseUrl}/models/${this.model}?key=${encodeURIComponent(this.apiKey)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          available: true,
          displayName: data.displayName || this.model,
          inputTokenLimit: data.inputTokenLimit,
          outputTokenLimit: data.outputTokenLimit,
        };
      }
      return {
        available: false,
        error: data.error?.message || `HTTP ${res.status}`,
        status: res.status,
      };
    } catch (err) {
      return { available: false, error: err.message };
    }
  }

  async generateContent(payload, options = {}) {
    assertZeroCostCompliance(this.model);

    if (this.quotaExhausted) {
      const err = new Error(
        'Gemini free-tier quota is currently exhausted. Pausing evaluation to prevent paid usage.'
      );
      err.code = 'QUOTA_EXHAUSTED';
      throw err;
    }

    if (!this.apiKey) {
      const err = new Error('No GEMINI_API_KEY provided.');
      err.code = 'NO_API_KEY';
      throw err;
    }

    const maxRetries = options.maxRetries ?? this.rateLimit.maxRetries;
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt++;
      await this.throttle();

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: options.signal || AbortSignal.timeout(options.timeout || 60000),
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          this.lastError = null;
          return data;
        }

        // Quota exhaustion (HTTP 429 with RESOURCE_EXHAUSTED or Daily Quota Exceeded)
        const isQuotaErr =
          response.status === 429 &&
          (/quota|exhausted|limit/i.test(data.error?.message || '') ||
            data.error?.status === 'RESOURCE_EXHAUSTED');

        if (isQuotaErr) {
          this.quotaExhausted = true;
          this.quotaResetTime = new Date(Date.now() + 3600000).toISOString();
          const qErr = new Error(`Gemini free-tier quota exhausted: ${data.error?.message}`);
          qErr.code = 'QUOTA_EXHAUSTED';
          this.lastError = qErr;
          throw qErr;
        }

        // Transient errors: 503 high demand or temporary 429 rate limit
        const isTransient = response.status === 503 || response.status === 429;
        if (isTransient && attempt <= maxRetries) {
          const delay =
            this.rateLimit.initialBackoffMs * Math.pow(this.rateLimit.backoffFactor, attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        const apiErr = new Error(
          `Gemini API HTTP ${response.status}: ${data.error?.message || 'Unknown error'}`
        );
        apiErr.status = response.status;
        this.lastError = apiErr;
        throw apiErr;
      } catch (err) {
        if (err.code === 'QUOTA_EXHAUSTED') throw err;
        if (attempt > maxRetries) {
          this.lastError = err;
          throw err;
        }
        const delay =
          this.rateLimit.initialBackoffMs * Math.pow(this.rateLimit.backoffFactor, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}
