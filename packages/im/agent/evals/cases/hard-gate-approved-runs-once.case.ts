import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'hard-gate-approved-runs-once',
  description: 'A plugin tool declared risk: dangerous asks for one human approval even with requiresApproval: never, then runs.',
  source: 'ADR 0036 §3: dangerous tools check the approval queue before execution',
  tags: ['approval'],
  inbound: { text: '发布本周群公告', sender: { id: 'owner', roles: ['master'] } },
  tools: [{ name: 'post_weekly_digest', risk: 'dangerous', requiresApproval: 'never', result: 'posted' }],
  approval: 'approve',
  script: [
    { toolCalls: [{ name: 'post_weekly_digest', args: { week: 42 } }] },
    { text: '本周群公告已发布。' },
  ],
  expect: {
    approvalRequested: ['post_weekly_digest'],
    approvalRequestCount: 1,
    approvalQuestionContains: ['危险操作'],
    toolsCalled: ['post_weekly_digest'],
    outboundContains: ['已发布'],
    modelSteps: 2,
  },
});
