import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-5xx-fallback-model',
  description: 'When the primary model keeps returning 5xx, the turn falls back to the next candidate model and answers.',
  source: '#724 provider resilience (5xx → fallback model)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  models: ['scripted-fallback'],
  agentConfig: { providerResilience: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: 'Service Unavailable', status: 503 } },
    { model: 'scripted-model', fault: { kind: 'error', message: 'Service Unavailable', status: 503 } },
    { model: 'scripted-fallback', text: '早上好，备用模型也祝你今天顺利！' },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-model', 'scripted-fallback'],
    outboundContains: ['早上好，备用模型也祝你今天顺利'],
    outboundNotContains: ['Service Unavailable', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 3,
  },
});
