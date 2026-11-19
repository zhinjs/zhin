import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-result-double-reply (review): on the default path one model step may send several delegates.
// They are sent together and waited for together (the tool runs in the parallel bucket and the turn's waits
// share one 20 s budget), so the step takes as long as the slowest sub-agent, never the sum, and the turn stays
// inside its timeout. Every result comes back in its tool result: the entry model answers once, and no result
// mail wakes it again.
export default defineEvalCase({
  id: 'harness-delegates-one-step-waited-together',
  description: 'Several default-path delegates in one step are waited for together; one answer from all results.',
  source: '#1250 delegate-result-double-reply',
  tags: ['collaboration'],
  inbound: { text: '查一下 Node 22 和 Node 24 分别什么时候停止维护', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  agents: [
    { name: 'node22', description: 'Looks up Node.js 22 release facts; read-only.', tools: [] },
    { name: 'node24', description: 'Looks up Node.js 24 release facts; read-only.', tools: [] },
  ],
  script: [
    { toolCalls: [
      { name: 'delegate', args: { agent: 'node22', brief: 'When does Node.js 22 reach end of life?' } },
      { name: 'delegate', args: { agent: 'node24', brief: 'When does Node.js 24 reach end of life?' } },
    ] },
    { actor: 'node22', text: 'Node.js 22 reaches end of life in April 2027.' },
    { actor: 'node24', text: 'Node.js 24 reaches end of life in April 2028.' },
    { text: 'Node 22 在 2027 年 4 月停止维护，Node 24 在 2028 年 4 月停止维护。' },
    // Trap: a second answer woken by a result mail.
    { text: 'Node 24 会在 2028 年 4 月停止维护。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['Node 22 在 2027 年 4 月停止维护，Node 24 在 2028 年 4 月停止维护。'],
    outboundNotContains: ['补充', 'Node 24 会在'],
    outboundMessages: 1,
    modelInputContains: ['agent node22 finished (completed', 'agent node24 finished (completed', 'April 2027', 'April 2028'],
    modelInputNotContains: ['[mail from node22 · result]', '[mail from node24 · result]', 'is still working after'],
    // entry: delegates, answer; one call per sub-agent. The trap is never requested.
    modelSteps: 4,
  },
});
