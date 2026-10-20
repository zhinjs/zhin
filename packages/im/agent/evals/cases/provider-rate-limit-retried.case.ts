import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-rate-limit-retried',
  description: 'A 429 from the provider is retried with backoff and the user gets the normal answer.',
  source: '#724 provider resilience (rate limit → retry)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  // Tiny backoff keeps the gate fast; the retry decision itself is what is under test.
  agentConfig: { providerResilience: { baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { fault: { kind: 'error', message: 'Too Many Requests', status: 429 } },
    { text: '早上好，今天也要元气满满！' },
  ],
  expect: {
    outboundContains: ['早上好，今天也要元气满满'],
    outboundNotContains: ['Too Many Requests', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
