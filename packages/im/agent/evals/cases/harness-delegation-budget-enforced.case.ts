import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.4 invariant 2: a delegation is funded from the delegator's remaining budget; the
// delegatee cannot exceed its grant. The branch ends budget_exceeded and still reports back.
export default defineEvalCase({
  id: 'harness-delegation-budget-enforced',
  description: 'A delegatee granted one model call is stopped after it, and the delegator still answers the human.',
  source: 'ADR 0048 §3.4 invariant 2 (budget conservation)',
  tags: ['collaboration', 'long-task', 'quota'],
  inbound: { text: '让 researcher 把所有版本的发布日期都查一遍', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'lookup_docs', result: 'v1: 2024-01' }],
  agents: [{ name: 'researcher', description: 'Looks things up; read-only.', tools: ['lookup_docs'] }],
  // The entry agent blocks on `ask`. researcher is granted one model call, which its first request spends; the
  // second step is a trap that must never be requested (the follow-up after the tool result is over budget).
  script: [
    { toolCalls: [{ name: 'ask', args: { agent: 'researcher', question: 'List the release date of every version.', budget: { modelCalls: 1 } } }] },
    { actor: 'researcher', toolCalls: [{ name: 'lookup_docs', args: { query: 'v1 release' } }] },
    { actor: 'researcher', toolCalls: [{ name: 'lookup_docs', args: { query: 'v2 release' } }] },
    { text: 'researcher 的预算用完了，只查到 v1 是 2024 年 1 月发布的，要继续查吗？' },
  ],
  allowUnusedSteps: true,
  expect: { outboundContains: ['预算用完了'], maxModelSteps: 3 },
});
