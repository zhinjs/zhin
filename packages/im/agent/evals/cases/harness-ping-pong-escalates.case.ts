import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.4 invariant 5: two agents bouncing the same question are frozen after a bounded number
// of round trips and the engagement escalates to the human instead of looping.
export default defineEvalCase({
  id: 'harness-ping-pong-escalates',
  description: 'Two agents asking each other the same thing are stopped within the round-trip limit; the loop never runs out the script.',
  source: 'ADR 0048 §3.4 invariant 5 (loop convergence)',
  skip: 'ADR 0048 H2：协作工具（agents/ask/delegate）与 Guard Kernel 尚未实现，实现后去掉 skip',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '这个需求该谁做？', sender: { id: 'master', roles: ['master'] } },
  agents: [
    { name: 'alice', description: 'Frontend.', tools: [], collaboration: { contacts: ['bob'] } },
    { name: 'bob', description: 'Backend.', tools: [], collaboration: { contacts: ['alice'] } },
  ],
  script: [
    { toolCalls: [{ name: 'ask', args: { agent: 'alice', question: 'Who should own this?' } }] },
    { toolCalls: [{ name: 'ask', args: { agent: 'bob', question: 'Who should own this?' } }] },
    { toolCalls: [{ name: 'ask', args: { agent: 'alice', question: 'Who should own this?' } }] },
    { toolCalls: [{ name: 'ask', args: { agent: 'bob', question: 'Who should own this?' } }] },
    { toolCalls: [{ name: 'ask', args: { agent: 'alice', question: 'Who should own this?' } }] },
    { toolCalls: [{ name: 'ask', args: { agent: 'bob', question: 'Who should own this?' } }] },
    { toolCalls: [{ name: 'ask', args: { agent: 'alice', question: 'Who should own this?' } }] },
    { toolCalls: [{ name: 'ask', args: { agent: 'bob', question: 'Who should own this?' } }] },
    { text: 'alice 和 bob 互相推了几轮没定下来，这个需要你来决定由谁负责。' },
  ],
  allowUnusedSteps: true,
  expect: { maxModelSteps: 7 },
});
