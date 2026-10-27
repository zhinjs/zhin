import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'hard-gate-denied-category-latched-group',
  description: 'In a group turn, denying one member-management tool latches the whole member category: a same-turn switch from group_kick to set_group_ban fails closed without a second approval card.',
  source: 'ADR 0037 Phase 1 D5 (#1012): same turn locks the denied tool and its category; no reinject or retry in the same turn',
  tags: ['approval'],
  inbound: { text: '@bot 把 10086 踢出群，不行就禁言他', scope: 'group', sender: { id: 'owner', roles: ['master'] } },
  tools: [
    { name: 'group_kick', result: 'kicked' },
    { name: 'set_group_ban', result: 'banned' },
  ],
  approval: 'deny',
  script: [
    { toolCalls: [{ name: 'group_kick', args: { user_id: 10086 } }] },
    { toolCalls: [{ name: 'set_group_ban', args: { user_id: 10086, duration: 600 } }] },
    { text: '踢人和禁言都需要管理员人工审批，这次没有执行。' },
  ],
  expect: {
    approvalRequested: ['group_kick'],
    approvalRequestCount: 1,
    toolsNotCalled: ['group_kick', 'set_group_ban'],
    modelInputContains: ['不要重试'],
    outboundContains: ['人工审批'],
    modelSteps: 3,
  },
});
