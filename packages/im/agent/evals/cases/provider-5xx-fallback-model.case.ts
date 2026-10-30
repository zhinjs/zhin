import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-5xx-fallback-model',
  description: 'When the fixed primary keeps returning 5xx, retry only that model and report failure without calling registered alternatives.',
  source: '2026-10-30 approved fixed chat model policy (including legacy config); #724 same-model retries remain',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候', sender: { id: 'owner', roles: ['master'] } },
  // Registered alternatives must never receive a chat request under the fixed-model policy.
  models: ['scripted-fallback'],
  agentConfig: { providerResilience: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: 'Service Unavailable', status: 503 } },
    { model: 'scripted-model', fault: { kind: 'error', message: 'Service Unavailable', status: 503 } },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-model'],
    outboundContains: ['（模型服务不可用）'],
    outboundNotContains: ['早上好', 'Service Unavailable', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
