import { defineEvalCase } from '../framework/index.js';

/**
 * A member is not an operator: when the provider fails, the bot says it lagged, the way a group
 * member would, and never mentions models, keys or retries. The cause is for the owner only.
 */
export default defineEvalCase({
  id: 'provider-failure-member-voice',
  description: 'When every retry hits a 5xx, a member gets a chat-voice line with no provider internals and no cause.',
  source: 'QQ: "模型调用失败：…请检查 API 密钥与网络后重试" sent into the group (#945)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  agentConfig: { providerResilience: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  script: [
    { fault: { kind: 'error', message: 'upstream exploded: internal trace id 42', status: 503 } },
    { fault: { kind: 'error', message: 'upstream exploded: internal trace id 42', status: 503 } },
  ],
  expect: {
    outboundContains: ['再'],
    outboundNotContains: ['模型', 'API', '密钥', '重试', '稍后再试', '不可用', '（', 'upstream exploded'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
