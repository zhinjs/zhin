import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.4 invariant 4: approvals go to the engagement's human principal, never to another agent.
// Successor of subagent-approval-routed once spawn_task is removed (H2).
export default defineEvalCase({
  id: 'harness-approval-routed-to-principal',
  description: "A delegatee's approval-gated call is asked of the human who started the engagement; a denial stops it.",
  source: 'ADR 0048 §3.4 invariant 4 (approvals belong to humans)',
  tags: ['collaboration', 'approval'],
  inbound: { text: '让 ops 清理一下旧日志', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'purge_logs', requiresApproval: 'once', result: 'purged' }],
  approval: 'deny',
  agents: [{ name: 'ops', description: 'Runs maintenance.', tools: ['purge_logs'] }],
  // Entry steps are untagged; `ask` blocks the entry agent until ops finishes its turn.
  script: [
    { toolCalls: [{ name: 'ask', args: { agent: 'ops', question: 'Purge logs older than 30 days.' } }] },
    { actor: 'ops', toolCalls: [{ name: 'purge_logs', args: { olderThanDays: 30 } }] },
    { actor: 'ops', text: 'Purge was denied by the user; nothing deleted.' },
    { text: '清理旧日志需要你批准，你没有批准，所以什么都没删。' },
  ],
  expect: { approvalRequested: ['purge_logs'], toolsNotCalled: ['purge_logs'], outboundContains: ['什么都没删'], modelSteps: 4 },
});
