import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-failure-message-flood: the guard stops a request's collaboration in the background, after the
// entry agent already acknowledged. No entry turn runs that could explain it, so the human gets one short
// localized line — never the guard's developer text, never "需要你来决定" (nobody can resume a stopped
// request) — and the cancelled delegation does not wake the entry agent for another message.
export default defineEvalCase({
  id: 'harness-background-stop-one-line',
  description: 'A guard stop in background collaboration is told once in plain words; its cancelled results stay in the trace.',
  source: '#1250 delegate-failure-message-flood',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '让 alice 和 bob 一起把方案定下来', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  agents: [
    { name: 'alice', description: 'Frontend.', tools: [], collaboration: { contacts: ['bob'] } },
    { name: 'bob', description: 'Backend.', tools: [] },
  ],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'alice', brief: 'Agree on the plan with bob.' } }] },
    { text: '已经交给 alice 和 bob 去商量了。' },
    // alice keeps asking bob; the fourth ask trips the pair round-trip guard while no entry turn runs.
    { actor: 'alice', toolCalls: [{ name: 'ask', args: { agent: 'bob', question: 'Which API style?' } }] },
    { actor: 'bob', text: 'REST.' },
    { actor: 'alice', toolCalls: [{ name: 'ask', args: { agent: 'bob', question: 'Which database?' } }] },
    { actor: 'bob', text: 'PostgreSQL.' },
    { actor: 'alice', toolCalls: [{ name: 'ask', args: { agent: 'bob', question: 'Which queue?' } }] },
    { actor: 'bob', text: 'None for now.' },
    { actor: 'alice', toolCalls: [{ name: 'ask', args: { agent: 'bob', question: 'Which cache?' } }] },
    { actor: 'alice', text: '方案基本定了。' },
    // Trap: the cancelled delegation must not wake the entry agent for another message.
    { text: '协作被暂停了，需要你来决定。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['已经交给 alice', '后台任务已停止'],
    outboundNotContains: ['Actors', 'above the limit', '协作已暂停', '需要你来决定'],
    outboundMessages: 2,
  },
});
