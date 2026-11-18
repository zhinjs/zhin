import { defineEvalCase } from '../framework/index.js';

// #1250 agent-purpose-binding-ignored (root cause): when the turn is routed to a specialist (here `@planner`; also an
// endpoint's preferred agent or a platform-matched agent), planner is the turn's entry agent, not a sub-agent. Its root
// turn and the entry actor turns of its engagement must still run on purposes.agents.planner, never on the adapter
// chat override (purposes.adapters.<adapter>.chat), which is what every planner call used before.
export default defineEvalCase({
  id: 'harness-routed-specialist-purpose',
  description: 'A turn routed to a specialist runs on the specialist binding, not on the adapter chat override, including its delegation results.',
  source: '#1250 agent-purpose-binding-ignored',
  tags: ['collaboration'],
  inbound: { text: '@planner 列三行周末安排', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  models: ['planner-model', 'sandbox-chat'],
  purposes: { agents: { planner: 'planner-model' }, adapterChat: 'sandbox-chat' },
  agents: [
    { name: 'planner', description: 'Plans things.', tools: [], collaboration: { contacts: ['researcher'] } },
    // No binding of its own: it runs on chat, where the adapter override applies.
    { name: 'researcher', description: 'Looks things up.', tools: [] },
  ],
  script: [
    { actor: 'planner', model: 'planner-model', toolCalls: [{ name: 'delegate', args: { agent: 'researcher', brief: 'Find weekend ideas.', wait: false } }] },
    { actor: 'planner', model: 'planner-model', text: '我先让 researcher 找点想法，稍后给你。' },
    { actor: 'researcher', model: 'sandbox-chat', text: '爬山、看书、做饭' },
    { actor: 'planner', model: 'planner-model', text: '周末安排：周六爬山，周日看书，晚上做饭。' },
  ],
  allowUnusedSteps: true,
  expect: { outboundContains: ['周末安排'] },
});
