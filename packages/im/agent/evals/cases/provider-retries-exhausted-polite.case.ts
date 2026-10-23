import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-retries-exhausted-polite',
  description: 'When every retry hits a 5xx, the owner gets a chat-voice line with the cause instead of the raw provider error.',
  source: '#724 provider resilience (retries exhausted → friendly feedback)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候', sender: { id: 'owner', roles: ['master'] } },
  agentConfig: { providerResilience: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { fault: { kind: 'error', message: 'upstream exploded: internal trace id 42', status: 503 } },
    { fault: { kind: 'error', message: 'upstream exploded: internal trace id 42', status: 503 } },
  ],
  expect: {
    outboundContains: ['（模型服务不可用）'],
    outboundNotContains: ['upstream exploded', 'trace id', '请检查 API 密钥'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
