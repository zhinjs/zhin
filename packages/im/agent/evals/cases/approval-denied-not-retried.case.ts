import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'approval-denied-not-retried',
  description: 'A user denial is reported to the model as a decision (not a retryable error); the tool never runs.',
  source: 'QQ: approval silently denied and the model kept retrying (#716 agent-im-approval)',
  tags: ['approval'],
  inbound: { text: '删除昨天的备份', sender: { id: 'owner', roles: ['master'] } },
  tools: [{ name: 'delete_backup', requiresApproval: 'once', result: 'deleted' }],
  approval: 'deny',
  script: [
    { toolCalls: [{ name: 'delete_backup', args: { day: 'yesterday' } }] },
    { text: '你拒绝了删除操作，备份保留不动。' },
  ],
  expect: {
    approvalRequested: ['delete_backup'],
    toolsNotCalled: ['delete_backup'],
    outboundContains: ['备份保留不动'],
    modelSteps: 2,
  },
});
