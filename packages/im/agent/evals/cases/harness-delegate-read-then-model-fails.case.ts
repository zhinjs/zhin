import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-result-double-reply (review): a waited delegate returns the sub-agent's result, then the entry
// model's next request fails. Marking the result as read at once lost it: the human got only an error line and
// the result mail never woke the entry agent. A read counts only once the turn's answer reached the human; the
// failed turn revokes it, so the result wakes the entry agent as before and the conclusion still goes out.
export default defineEvalCase({
  id: 'harness-delegate-read-then-model-fails',
  description: 'A waited result whose turn then fails is not lost: it wakes the entry agent and the conclusion goes out.',
  source: '#1250 delegate-result-double-reply',
  tags: ['collaboration'],
  inbound: { text: '查一下 Node 24 什么时候停止维护', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  agents: [{ name: 'researcher', description: 'Looks things up; read-only.', tools: [] }],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'researcher', brief: 'When does Node.js 24 reach end of life?' } }] },
    { actor: 'researcher', text: 'Node.js 24 reaches end of life in April 2028.' },
    // The entry model's answer request fails after it read the result.
    { fault: { kind: 'error', message: 'invalid request: upstream rejected the message', status: 400 } },
    // The result mail wakes the entry agent: its answer reaches the human.
    { text: 'Node 24 会在 2028 年 4 月停止维护。' },
  ],
  expect: {
    outboundContains: ['2028 年 4 月停止维护'],
    modelInputContains: ['agent researcher finished (completed', '[mail from researcher · result]'],
  },
});
