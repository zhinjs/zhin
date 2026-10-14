import { defineEvalCase } from '../framework/index.js';

/** A busy group hits its per-minute limit; a private chat with the same member is unaffected. */
export default defineEvalCase({
  id: 'quota-group-rate-limited',
  description: 'perGroupRequestsPerMinute stops further group turns with a notice, while private chats continue.',
  source: '#727 cost / abuse control — per-group rate limit',
  tags: ['quota'],
  agentConfig: { usageQuota: { perGroupRequestsPerMinute: 1 } },
  inbound: [
    { text: '@bot 早', scope: 'group', sender: { id: 'alice', roles: ['user'] } },
    { text: '@bot 早啊', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
    { text: '私聊问一下', sender: { id: 'bob', roles: ['user'] } },
  ],
  script: [
    { text: '早上好！' },
    { text: '私聊收到。' },
  ],
  expect: {
    outboundContains: ['早上好', '本群消息太多啦', '私聊收到'],
    modelSteps: 2,
  },
});
