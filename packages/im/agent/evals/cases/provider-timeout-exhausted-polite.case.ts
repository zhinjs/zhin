import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-timeout-exhausted-polite',
  description: 'When every attempt hangs past the request timeout, the owner gets a chat-voice line saying the model timed out.',
  source: '#724 provider resilience (timeouts exhausted → friendly feedback)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候', sender: { id: 'owner', roles: ['master'] } },
  agentConfig: { providerResilience: { requestTimeoutMs: 30_000, maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { fault: { kind: 'hang' } },
    { fault: { kind: 'hang' } },
  ],
  expect: {
    outboundContains: ['（模型超时）'],
    outboundNotContains: ['timed out after', '请检查 API 密钥'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
