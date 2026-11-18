import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-result-double-reply (review): nested delegation. The entry agent delegates to `planner`, which
// delegates to `researcher` and reads the result within its own turn. Only the entry agent used to skip a result
// it already read: the researcher's result mail woke `planner` again for an extra, empty model turn. Every actor
// now skips results it read in a completed turn.
export default defineEvalCase({
  id: 'harness-nested-delegate-no-empty-turn',
  description: 'A sub-agent that waited for its own delegation is not woken again by that result.',
  source: '#1250 delegate-result-double-reply',
  tags: ['collaboration'],
  inbound: { text: '帮我规划一下周末去看 Node 大会', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  agents: [
    { name: 'planner', description: 'Plans trips; may ask researcher for facts.', tools: [], collaboration: { contacts: ['researcher'] } },
    { name: 'researcher', description: 'Looks things up; read-only.', tools: [] },
  ],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'planner', brief: 'Plan a weekend trip to the Node conference.' } }] },
    { actor: 'planner', toolCalls: [{ name: 'delegate', args: { agent: 'researcher', brief: 'When is the Node conference?' } }] },
    { actor: 'researcher', text: 'The Node conference is on Saturday.' },
    { actor: 'planner', text: 'Go on Saturday morning, back Sunday.' },
    // Trap: planner woken again by the researcher's result mail.
    { actor: 'planner', text: 'The conference is on Saturday.' },
    { text: '大会在周六，建议周六上午出发、周日返回。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['建议周六上午出发'],
    outboundMessages: 1,
    modelInputContains: ['agent researcher finished (completed', 'agent planner finished (completed'],
    modelInputNotContains: ['[mail from researcher · result]'],
    // entry: delegate, answer; planner: delegate, answer; researcher: one call. The trap is never requested.
    modelSteps: 5,
  },
});
