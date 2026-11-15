import { defineEvalCase } from '../framework/index.js';

// #1250 batch 21 delegate-budget-self-sabotage (owner decision): a budget the model writes into
// `ask` below one complete answer is raised to MIN_DELEGATION_BUDGET, the tool result says so,
// and the delegatee can finish its answer instead of being stopped after one call.
export default defineEvalCase({
  id: 'harness-delegation-budget-floor',
  description: 'A model-chosen budget below one complete answer is raised to the floor and reported; the delegatee finishes.',
  source: '#1250 delegate-budget-self-sabotage (MIN_DELEGATION_BUDGET)',
  tags: ['collaboration', 'quota'],
  inbound: { text: '让 researcher 查一下 v1 的发布日期', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'lookup_docs', result: 'v1: 2024-01' }],
  agents: [{ name: 'researcher', description: 'Looks things up; read-only.', tools: ['lookup_docs'] }],
  script: [
    { toolCalls: [{ name: 'ask', args: { agent: 'researcher', question: 'When was v1 released?', budget: { modelCalls: 1, tokens: 250 } } }] },
    { actor: 'researcher', toolCalls: [{ name: 'lookup_docs', args: { query: 'v1 release' } }] },
    // With the one-call budget the model asked for, this second request would have been refused.
    { actor: 'researcher', text: 'v1 was released in 2024-01.' },
    { text: 'v1 是 2024 年 1 月发布的。' },
  ],
  expect: {
    toolsCalled: ['ask', 'lookup_docs'],
    modelInputContains: ['budget raised to the minimum for one complete answer: modelCalls 1→4, tokens 250→32000', 'v1 was released in 2024-01.'],
    outboundContains: ['2024 年 1 月'],
    modelSteps: 4,
  },
});
