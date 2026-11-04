import { defineEvalCase } from '../framework/index.js';

/**
 * Gemini per-day quota: still a 429 RESOURCE_EXHAUSTED with a short RetryInfo,
 * but the QuotaFailure names a `PerDay` quota, so waiting cannot help today.
 * The selected chat model is fixed even if another registered model has quota.
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
  description: 'A Gemini per-day quota 429 fails on the fixed primary without retrying or calling a registered alternative.',
  source: '2026-10-30 approved fixed chat model policy (including legacy config); #724/#770 daily quota remains non-retryable',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候', sender: { id: 'owner', roles: ['master'] } },
  // Registered alternatives must never receive a chat request under the fixed-model policy.
  models: ['scripted-fallback'],
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: DAILY_QUOTA.error.message, status: 429, body: DAILY_QUOTA } },
  ],
  expect: {
    modelIds: ['scripted-model'],
    outboundContains: ['（模型额度用完了）'],
    outboundNotContains: ['早上好', 'exceeded your current quota', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 1,
  },
});
