import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'deferred-kick-autoload-hard-gate',
  description: 'A deferred dangerous tool called by exact name auto-loads in one step, and the hard-gate approval still runs.',
  source: 'ADR 0042 §3: discover-and-call (was discover -> load_tool -> call -> reply, 4 model calls)',
  tags: ['tool-use', 'approval'],
  inbound: { text: '把 12345 踢出群', scope: 'group', sender: { id: 'owner', roles: ['master'] } },
  tools: [{ name: 'group_kick', description: 'Remove a member from the group.', deferred: true, risk: 'dangerous', requiresApproval: 'never', result: 'kicked' }],
  approval: 'approve',
  script: [
    { toolCalls: [{ name: 'group_kick', args: { user_id: '12345' }, notOffered: true }] },
    { text: '已把 12345 踢出群。' },
  ],
  expect: {
    approvalRequested: ['group_kick'],
    approvalRequestCount: 1,
    toolsCalled: ['group_kick'],
    outboundContains: ['已把 12345 踢出群'],
    modelSteps: 2,
  },
});
