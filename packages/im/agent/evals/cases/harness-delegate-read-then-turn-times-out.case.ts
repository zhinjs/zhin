import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-result-double-reply (review): as harness-delegate-read-then-model-fails, but the entry model's
// next request never answers and the turn times out. The read is revoked with the turn; the result wakes the
// entry agent and the sub-agent's conclusion still reaches the human.
export default defineEvalCase({
  id: 'harness-delegate-read-then-turn-times-out',
  description: 'A waited result whose turn then times out is not lost: the conclusion still goes out.',
  source: '#1250 delegate-result-double-reply',
  tags: ['collaboration', 'resilience'],
  inbound: { text: '查一下 Node 24 什么时候停止维护', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  agents: [{ name: 'researcher', description: 'Looks things up; read-only.', tools: [] }],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'researcher', brief: 'When does Node.js 24 reach end of life?' } }] },
    { actor: 'researcher', text: 'Node.js 24 reaches end of life in April 2028.' },
    { fault: { kind: 'hang' } },
    { text: 'Node 24 会在 2028 年 4 月停止维护。' },
  ],
  expect: {
    outboundContains: ['2028 年 4 月停止维护'],
    modelInputContains: ['agent researcher finished (completed', '[mail from researcher · result]'],
  },
});
