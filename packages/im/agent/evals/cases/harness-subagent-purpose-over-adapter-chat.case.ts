import { defineEvalCase } from '../framework/index.js';

// #1250 agent-purpose-binding-ignored (owner decision): a model bound to a sub-agent (purposes.agents.<key>,
// Console 用途 → Agent) wins over the adapter's chat override (purposes.adapters.<adapter>.chat). The reported
// sequence: the entry agent delegates to planner, follows up, then asks it with a model-chosen budget. Every planner
// request must go to planner's model, every entry request (root turn and actor:zhin) to the adapter's chat model.
export default defineEvalCase({
  id: 'harness-subagent-purpose-over-adapter-chat',
  description: 'Sub-agent turns run on the sub-agent binding, not on the adapter chat override, through delegate / follow_up / ask.',
  source: '#1250 agent-purpose-binding-ignored',
  tags: ['collaboration'],
  inbound: { text: '让 planner 列三行周末安排', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  models: ['planner-model', 'sandbox-chat'],
  purposes: { agents: { planner: 'planner-model' }, adapterChat: 'sandbox-chat' },
  agents: [{ name: 'planner', description: 'Plans things.', tools: [] }],
  script: [
    { model: 'sandbox-chat', toolCalls: [{ name: 'delegate', args: { agent: 'planner', brief: 'List a three-line weekend plan.' } }] },
    { actor: 'planner', model: 'planner-model', text: '周六爬山\n周日看书\n周日晚上做饭' },
    { model: 'sandbox-chat', toolCalls: [{ name: 'follow_up', args: { mail_id: 'm-eval-3', content: 'Keep it short.', budget: { modelCalls: 1, tokens: 250 } } }] },
    { actor: 'planner', model: 'planner-model', text: '已经很短了。' },
    { model: 'sandbox-chat', toolCalls: [{ name: 'ask', args: { agent: 'planner', question: 'Anything else?', budget: { modelCalls: 1, tokens: 250 } } }] },
    { actor: 'planner', model: 'planner-model', text: '没有了。' },
    { model: 'sandbox-chat', text: '周末安排：周六爬山，周日看书，晚上做饭。' },
    // actor:zhin: the entry agent continues with planner's delegated result on the root turn's purpose (chat).
    { model: 'sandbox-chat', text: 'planner 的完整安排已经发给你了。' },
  ],
  expect: { outboundContains: ['周末安排'], toolsCalled: ['delegate', 'follow_up', 'ask'] },
});
