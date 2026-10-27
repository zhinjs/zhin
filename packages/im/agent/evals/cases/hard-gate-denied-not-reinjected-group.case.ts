import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'hard-gate-denied-not-reinjected-group',
  description: 'In a group turn, a hard-gate denial reaches the model as a do-not-retry note; a same-turn retry of the denied tool with new arguments fails closed without a second approval card.',
  source: 'ADR 0037 Phase 1 D5 (#1012): same turn locks the denied tool and its category; no reinject or retry in the same turn',
  tags: ['approval'],
  inbound: { text: '@bot 把 10086 踢出群', scope: 'group', sender: { id: 'owner', roles: ['master'] } },
  tools: [{ name: 'group_kick', result: 'kicked' }],
  approval: 'deny',
  script: [
    { toolCalls: [{ name: 'group_kick', args: { user_id: 10086 } }] },
    { toolCalls: [{ name: 'group_kick', args: { user_id: 10086, reason: 'retry after deny' } }] },
    { text: '踢人需要管理员人工审批，这次没有执行。' },
  ],
  expect: {
    approvalRequested: ['group_kick'],
    approvalRequestCount: 1,
    toolsNotCalled: ['group_kick'],
    modelInputContains: ['不要重试'],
    outboundContains: ['人工审批'],
    modelSteps: 3,
  },
});
