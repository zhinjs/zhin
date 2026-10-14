import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'approval-approved-runs',
  description: 'An approval-gated tool asks first and runs once approved.',
  source: '#716 typed approval outcomes (happy path baseline)',
  tags: ['approval'],
  inbound: { text: '把这份周报发到运营群', sender: { id: 'owner', roles: ['master'] } },
  tools: [{ name: 'publish_report', requiresApproval: 'once', result: 'published' }],
  approval: 'approve',
  script: [
    { toolCalls: [{ name: 'publish_report', args: { target: 'ops' } }] },
    { text: '已发布到运营群。' },
  ],
  expect: {
    approvalRequested: ['publish_report'],
    toolsCalled: ['publish_report'],
    outboundContains: ['已发布'],
    modelSteps: 2,
  },
});
