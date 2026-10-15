import { defineEvalCase } from '../framework/index.js';

const UNAVAILABLE = {
  error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' },
};

export default defineEvalCase({
  id: 'provider-gemini-unavailable-fallback',
  description: 'Gemini 503 UNAVAILABLE is retried with backoff; when it keeps failing the turn falls back to the next candidate model.',
  source: '#724 provider resilience, Gemini primary (#770): 503 UNAVAILABLE → retry → fallback',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  models: ['scripted-fallback'],
  agentConfig: { providerResilience: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: UNAVAILABLE.error.message, status: 503, body: UNAVAILABLE } },
    { model: 'scripted-model', fault: { kind: 'error', message: UNAVAILABLE.error.message, status: 503, body: UNAVAILABLE } },
    { model: 'scripted-fallback', text: '早上好，祝你今天一切顺利！' },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-model', 'scripted-fallback'],
    outboundContains: ['早上好，祝你今天一切顺利'],
    outboundNotContains: ['overloaded', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 3,
  },
});
