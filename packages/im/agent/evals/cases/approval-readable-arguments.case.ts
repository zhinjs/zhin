import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'approval-readable-arguments',
  description: 'A plugin approval shows its readable action and exact arguments, then executes once approved.',
  source: 'ICQQ operation-confirmation report: internal tool names and policy boilerplate obscured the actual operation',
  tags: ['approval'],
  inbound: { text: '把周报发到运营群', sender: { id: 'owner', roles: ['master'] } },
  tools: [{ name: 'reports__publish_report', description: '发送周报；目标由参数指定', requiresApproval: 'always', result: 'published' }],
  approval: 'approve',
  script: [
    { toolCalls: [{ name: 'reports__publish_report', args: { target: 'ops', week: 42 } }] },
    { text: '周报已发布到运营群。' },
  ],
  expect: {
    approvalRequested: ['reports__publish_report'],
    approvalRequestCount: 1,
    approvalQuestionContains: ['发送周报', '"target":"ops"', '"week":42'],
    toolsCalled: ['reports__publish_report'],
    outboundContains: ['已发布'],
    modelSteps: 2,
  },
});
