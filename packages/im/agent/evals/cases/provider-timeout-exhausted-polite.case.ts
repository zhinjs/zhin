import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-timeout-exhausted-polite',
  description: 'When every attempt hangs past the request timeout, the user gets a polite timeout notice.',
  source: '#724 provider resilience (timeouts exhausted → friendly feedback)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  agentConfig: { providerResilience: { requestTimeoutMs: 30_000, maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { fault: { kind: 'hang' } },
    { fault: { kind: 'hang' } },
  ],
  expect: {
    outboundContains: ['模型服务响应超时', '稍后再试'],
    outboundNotContains: ['timed out after', '请检查 API 密钥'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
