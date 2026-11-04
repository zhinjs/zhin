import { defineEvalCase } from '../framework/index.js';

const UNAVAILABLE = {
  error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' },
};

export default defineEvalCase({
  id: 'provider-gemini-unavailable-fallback',
  description: 'Gemini 503 UNAVAILABLE retries only the fixed primary; exhaustion reports failure without calling a registered alternative.',
  source: '2026-10-30 approved fixed chat model policy (including legacy config); #724/#770 Gemini same-model retries remain',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候', sender: { id: 'owner', roles: ['master'] } },
  // Registered alternatives must never receive a chat request under the fixed-model policy.
  models: ['scripted-fallback'],
  agentConfig: { providerResilience: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: UNAVAILABLE.error.message, status: 503, body: UNAVAILABLE } },
    { model: 'scripted-model', fault: { kind: 'error', message: UNAVAILABLE.error.message, status: 503, body: UNAVAILABLE } },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-model'],
    outboundContains: ['（模型服务不可用）'],
    outboundNotContains: ['早上好', 'overloaded', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
