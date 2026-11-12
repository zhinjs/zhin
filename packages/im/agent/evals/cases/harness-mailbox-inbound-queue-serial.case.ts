import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.1 / §8 H3: the inbound queue (today's `inboundQueue`) becomes a Mailbox policy.
// One Actor is serial within one Engagement: a second human Mail that arrives while the first turn is
// still running is queued and answered in its own turn afterwards, never interleaved or dropped.
export default defineEvalCase({
  id: 'harness-mailbox-inbound-queue-serial',
  description: 'Two human Mails to the same Actor are answered in order, one turn each, with the second seeing the first in history.',
  source: 'ADR 0048 §3.1 / §8 H3 (Mailbox absorbs the inbound queue; one Actor is serial per Engagement)',
  tags: ['collaboration', 'long-task'],
  inbound: [
    { text: '帮我记一下：周五交周报', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
    { text: '我刚才让你记的是什么？', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  ],
  script: [
    { text: '记下了：周五交周报。' },
    { text: '你让我记的是：周五交周报。' },
  ],
  expect: {
    modelSteps: 2,
    outboundMessages: 2,
    outboundContains: ['记下了', '你让我记的是：周五交周报'],
    requestInputContains: { 2: ['周五交周报'] },
  },
});
