import { defineEvalCase } from '../framework/index.js';

// #1250 batch 26 review (B1): the guard stops collaboration between two sub-agents while the entry agent's
// root turn is still busy with other tools. The root model never meets the stop (none of its own sends is
// refused), so it only says "已经交给 alice 和 bob 了". When the root turn ends, the human still gets the one
// localized stop line; the cancelled delegation stays in the trace.
export default defineEvalCase({
  id: 'harness-stop-during-root-told',
  description: 'A guard stop the root turn never saw is told with one line when the root turn ends.',
  source: '#1250 batch 26 review (B1)',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '让 alice 和 bob 一起把方案定下来，顺便查查资料', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'lookup_notes', result: 'notes: nothing new' }],
  agents: [
    { name: 'alice', description: 'Frontend.', tools: [], collaboration: { contacts: ['bob'] } },
    { name: 'bob', description: 'Backend.', tools: [] },
  ],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'alice', brief: 'Agree on the plan with bob.', wait: false } }] },
    // The root keeps working on ordinary tools while alice and bob run into the pair round-trip limit.
    ...Array.from({ length: 12 }, (_, index) => ({ toolCalls: [{ name: 'lookup_notes', args: { page: index + 1 } }] })),
    { text: '已经交给 alice 和 bob 去商量了，资料也查过了。' },
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
    outboundContains: ['已经交给 alice 和 bob', '后台任务已停止：这次请求的协作次数到了上限。'],
    outboundNotContains: ['Actors', 'above the limit', '协作已暂停', '需要你来决定'],
    outboundMessages: 2,
  },
});
