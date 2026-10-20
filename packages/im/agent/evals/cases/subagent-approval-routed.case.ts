import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'subagent-approval-routed',
  description: "A sub-agent's approval-gated call goes to the parent conversation's approval channel; a denial stops it.",
  source: '#718 sub-agent approvals routed to the parent requester',
  tags: ['subagent', 'approval'],
  inbound: { text: '让子任务清理一下旧日志', sender: { id: 'master', roles: ['master'] } },
  agentConfig: { subagentTurnMode: 'sync' },
  tools: [{ name: 'purge_logs', requiresApproval: 'once', result: 'purged' }],
  approval: 'deny',
  script: [
    { toolCalls: [{ name: 'spawn_task', args: { task: 'Purge logs older than 30 days.' } }] },
    { toolCalls: [{ name: 'purge_logs', args: { olderThanDays: 30 } }] },
    { text: 'Purge was denied by the user; nothing deleted.' },
    { text: '清理旧日志需要你批准，你没有批准，所以什么都没删。' },
  ],
  expect: {
    approvalRequested: ['purge_logs'],
    toolsNotCalled: ['purge_logs'],
    outboundContains: ['什么都没删'],
    modelSteps: 4,
  },
});
