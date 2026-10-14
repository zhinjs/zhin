import { defineEvalCase } from '../framework/index.js';

/** #734: a fact saved in a private chat is recalled (BM25) in a later group turn by the same user. */
export default defineEvalCase({
  id: 'memory-cross-session-recall',
  description: 'A preference saved in a DM is recalled into the turn context of a later group turn.',
  source: '#734 memory retrieval — cross-session recall',
  tags: ['memory'],
  inbound: [
    { text: '记住：我喜欢喝乌龙茶，不加糖', sender: { id: 'alice', roles: ['user'] } },
    { text: '@bot 帮我点一杯我喜欢的茶', scope: 'group', sender: { id: 'alice', roles: ['user'] } },
  ],
  nativeTools: ['memory_upsert'],
  script: [
    { toolCalls: [{ name: 'memory_upsert', args: { key: 'preference:tea', content: '喜欢喝乌龙茶，不加糖', kind: 'preference', scope: 'user' } }] },
    { text: '记住了。' },
    { text: '好的，给你点一杯不加糖的乌龙茶。' },
  ],
  expect: {
    toolsCalled: ['memory_upsert'],
    modelInputContains: ['Relevant memory', 'preference:tea: 喜欢喝乌龙茶，不加糖'],
    outboundContains: ['乌龙茶'],
    modelSteps: 3,
  },
});
