import { defineEvalCase } from '../framework/index.js';

/**
 * Gemini per-day quota: still a 429 RESOURCE_EXHAUSTED with a short RetryInfo,
 * but the QuotaFailure names a `PerDay` quota, so waiting cannot help today.
 * Quotas are per project and model, so another model may still answer.
 */
const DAILY_QUOTA = {
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
        }],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '14s' },
    ],
  },
};

export default defineEvalCase({
  id: 'provider-gemini-daily-quota-fallback',
  description: 'A Gemini per-day quota 429 is not retried on the same model; the turn falls back to the next candidate model.',
  source: '#724 provider resilience, Gemini primary (#770): daily quota → fallback without retry',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  models: ['scripted-fallback'],
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: DAILY_QUOTA.error.message, status: 429, body: DAILY_QUOTA } },
    { model: 'scripted-fallback', text: '早上好，备用模型来接班啦！' },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-fallback'],
    outboundContains: ['早上好，备用模型来接班啦'],
    outboundNotContains: ['exceeded your current quota', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
