import { defineEvalCase } from '../framework/index.js';

/** A user over their token quota gets a clear notice; another user carries on. */
export default defineEvalCase({
  id: 'quota-user-exhausted-others-unaffected',
  description: 'perUserTokens stops only the user who used it up, with an explicit message; a second user is unaffected.',
  source: '#727 cost / abuse control — per-user token quota',
  tags: ['quota'],
  agentConfig: { usageQuota: { perUserTokens: 100 } },
  inbound: [
    { text: '写一首长诗', sender: { id: 'alice', roles: ['user'] } },
    { text: '再写一首', sender: { id: 'alice', roles: ['user'] } },
    { text: '你好', sender: { id: 'bob', roles: ['user'] } },
  ],
  script: [
    { text: '这是一首长诗。', tokens: 150 },
    { text: '你好 Bob！', tokens: 10 },
  ],
  expect: {
    outboundContains: ['这是一首长诗', 'AI 用量已达上限', '其他人不受影响', '你好 Bob'],
    modelSteps: 2,
  },
});
