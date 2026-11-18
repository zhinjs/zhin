import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-result-double-reply: work delegated in the background (wait: false) finishes after the entry
// agent already answered. The result wakes the entry model once, with its earlier reply in view: when the
// result adds nothing it answers with the no-reply marker and the human hears nothing more; the result stays in
// the trace. A second delegation whose result does add something goes out once, marked as a supplement.
export default defineEvalCase({
  id: 'harness-late-result-supplements-once',
  description: 'A late delegated result after the answer: nothing new stays silent; something new goes out once as a supplement.',
  source: '#1250 delegate-result-double-reply',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '查一下 Node 24 什么时候进入 LTS，顺便看看什么时候停止维护', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  agents: [{ name: 'researcher', description: 'Looks things up; read-only.', tools: [] }],
  script: [
    { toolCalls: [
      { name: 'delegate', args: { agent: 'researcher', brief: 'When did Node.js 24 enter LTS?', wait: false } },
      { name: 'delegate', args: { agent: 'researcher', brief: 'When does Node.js 24 reach end of life?', wait: false } },
    ] },
    { text: 'Node 24 在 2025 年 10 月进入 LTS，停止维护时间我再确认一下。' },
    { actor: 'researcher', text: 'Node.js 24 entered Active LTS in October 2025.' },
    { actor: 'researcher', text: 'Node.js 24 reaches end of life in April 2028.' },
    // First result: the same answer the human already has.
    { text: '`[[NO_REPLY]]`' },
    // Second result: new content.
    { text: 'Node 24 会在 2028 年 4 月停止维护。' },
  ],
  expect: {
    outboundContains: ['2025 年 10 月进入 LTS', '补充：Node 24 会在 2028 年 4 月停止维护。'],
    outboundNotContains: ['[[no_reply]]', 'no_reply', 'NO_REPLY'],
    outboundMessages: 2,
    // The woken entry model saw what it had already said and the structured exit.
    // The earlier reply is shown as data (external content), not as instructions.
    modelInputContains: ['[Already answered]', '[external_content source="earlier_reply"', 'Node 24 在 2025 年 10 月进入 LTS', '[[no_reply]]'],
    modelSteps: 6,
  },
});
