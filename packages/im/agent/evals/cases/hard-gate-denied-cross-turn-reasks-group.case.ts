import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'hard-gate-denied-cross-turn-reasks-group',
  description: 'The same-turn hard-gate latch does not carry over: after a denial in one group turn, the next turn may ask for approval again, and a second denial still fails closed.',
  source: 'ADR 0037 Phase 1 D5 (#1012): cross-turn the agent may request approval again',
  tags: ['approval'],
  // This case is about the per-turn latch, not the group-ops cooldown (ADR 0037 slice E, #1031):
  // with the default 60s cooldown a denied card also blocks a second card in the next turn
  // (covered by hard-gate-denied-cross-turn-cooldown-group). The operator switch `ops.cooldownMs: 0`
  // isolates the latch: turn 2 must open a fresh card, and its denial must still fail closed.
  sessionOps: { defaults: { ops: { cooldownMs: 0 } } },
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
    { text: '审批再次被拒绝，踢人仍然没有执行。' },
  ],
  expect: {
    approvalRequested: ['group_kick'],
    approvalRequestCount: 2,
    toolsNotCalled: ['group_kick'],
    outboundContains: ['人工审批', '再次被拒绝'],
    modelSteps: 4,
  },
});
