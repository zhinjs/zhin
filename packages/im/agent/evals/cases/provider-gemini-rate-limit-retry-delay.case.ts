import { defineEvalCase } from '../framework/index.js';

/** Gemini 429 body: the wait comes from `RetryInfo.retryDelay`, not a `Retry-After` header. */
const RESOURCE_EXHAUSTED = {
  error: {
    code: 429,
    message: 'Resource has been exhausted (e.g. check quota).',
    status: 'RESOURCE_EXHAUSTED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.001s' }],
  },
};

export default defineEvalCase({
  id: 'provider-gemini-rate-limit-retry-delay',
  description: 'A Gemini 429 RESOURCE_EXHAUSTED is retried on the same model after its RetryInfo delay, and the user gets the normal answer.',
  source: '#724 provider resilience, Gemini primary (#770): 429 RESOURCE_EXHAUSTED → retry',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  models: ['scripted-fallback'],
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: RESOURCE_EXHAUSTED.error.message, status: 429, body: RESOURCE_EXHAUSTED } },
    { model: 'scripted-model', text: '早上好，今天也要元气满满！' },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-model'],
    outboundContains: ['早上好，今天也要元气满满'],
    outboundNotContains: ['Resource has been exhausted', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
