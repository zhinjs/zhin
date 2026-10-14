import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-timeout-retried',
  description: 'A hung provider request is aborted by the request timeout (virtual clock, no real wait) and retried.',
  source: '#724 provider resilience (request timeout → retry)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  agentConfig: { providerResilience: { requestTimeoutMs: 30_000, maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { fault: { kind: 'hang' } },
    { text: '早上好，刚才网络慢了一下，现在好了！' },
  ],
  expect: {
    outboundContains: ['早上好，刚才网络慢了一下'],
    outboundNotContains: ['timed out', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
