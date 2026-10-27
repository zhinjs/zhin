import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'hard-gate-denied-cross-turn-cooldown-group',
  description: 'With the default group-ops cooldown, a denied hard-gate card still counts: a re-ask in the next group turn within the window gets no new approval card and fails closed with a cooldown note.',
  source: 'ADR 0037 slice E (#1031): one card per platform + scene + action per ops.cooldownMs, denied cards included',
  tags: ['approval'],
  inbound: [
    { text: '@bot 把 10086 踢出群', scope: 'group', sender: { id: 'owner', roles: ['master'] } },
    { text: '@bot 我再申请一次，把 10086 踢出群', scope: 'group', sender: { id: 'owner', roles: ['master'] } },
  ],
  tools: [{ name: 'group_kick', result: 'kicked' }],
  approval: 'deny',
  script: [
    { toolCalls: [{ name: 'group_kick', args: { user_id: 10086 } }] },
    { text: '踢人需要管理员人工审批，这次没有执行。' },
    { toolCalls: [{ name: 'group_kick', args: { user_id: 10086 } }] },
    { text: '踢人操作冷却中，请稍后再试。' },
  ],
  expect: {
    approvalRequested: ['group_kick'],
    approvalRequestCount: 1,
    toolsNotCalled: ['group_kick'],
    modelInputContains: ['冷却中'],
    outboundContains: ['人工审批', '冷却中'],
    modelSteps: 4,
  },
});
