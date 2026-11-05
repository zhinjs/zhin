import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.4 invariant 1: the delegatee's own ceiling caps the work, even when the master delegates.
export default defineEvalCase({
  id: 'harness-delegatee-ceiling-not-widened',
  description: "A master's delegation does not lend the delegatee tools outside its own capability ceiling.",
  source: 'ADR 0048 §3.4 invariant 1 (delegatee ceiling)',
  tags: ['collaboration', 'approval'],
  inbound: { text: '让 researcher 查下日志保留策略，顺手把旧日志清了', sender: { id: 'master', roles: ['master'] } },
  tools: [
    { name: 'lookup_docs', result: 'Logs are kept for 30 days.' },
    { name: 'purge_logs', result: 'purged' },
  ],
  agents: [{ name: 'researcher', description: 'Looks things up; read-only.', tools: ['lookup_docs'] }],
  // Entry turn 1: delegate, then acknowledge. researcher runs in the background; its result wakes the entry agent.
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'researcher', brief: 'Find the log retention policy and purge old logs.' } }] },
    { text: '已经交给 researcher 去处理了。' },
    { actor: 'researcher', toolCalls: [{ name: 'lookup_docs', args: { query: 'log retention' } }, { name: 'purge_logs', args: { olderThanDays: 30 }, notOffered: true }] },
    { actor: 'researcher', text: 'Retention is 30 days. I cannot purge logs (outside my tools).' },
    { text: '日志保留 30 天。researcher 只能查不能删，旧日志还没清，要我换人处理吗？' },
  ],
  expect: { toolsCalled: ['lookup_docs'], toolsNotCalled: ['purge_logs'], outboundContains: ['还没清'], modelSteps: 5 },
});
