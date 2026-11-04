import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.3: delegate is asynchronous; the result comes back as a mail that wakes the delegator,
// which then answers the human. Nothing marks work "done" except the delegatee's result.
export default defineEvalCase({
  id: 'harness-delegate-result-wakes-delegator',
  description: 'An async delegation acknowledges first, then the result mail wakes the delegator to answer with it.',
  source: 'ADR 0048 §3.3 (delegate + result mail)',
  skip: 'ADR 0048 H2：协作工具（agents/ask/delegate）与 Guard Kernel 尚未实现，实现后去掉 skip',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '让 researcher 查一下 Node 24 什么时候进入 LTS', sender: { id: 'master', roles: ['master'] } },
  tools: [{ name: 'lookup_docs', result: 'Node.js 24 entered Active LTS in October 2025.' }],
  agents: [{ name: 'researcher', description: 'Looks things up; read-only.', tools: ['lookup_docs'] }],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'researcher', brief: 'When did Node.js 24 enter LTS?' } }], text: '已经交给 researcher 去查了。' },
    { toolCalls: [{ name: 'lookup_docs', args: { query: 'Node.js 24 LTS' } }] },
    { text: 'Node.js 24 entered Active LTS in October 2025.' },
    { text: 'researcher 查到了：Node 24 在 2025 年 10 月进入 LTS。' },
  ],
  expect: { toolsCalled: ['lookup_docs'], outboundContains: ['已经交给 researcher', '2025 年 10 月'], modelSteps: 4 },
});
