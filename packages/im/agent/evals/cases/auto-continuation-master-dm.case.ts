import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'continuous-master-dm',
  description: 'An interactive master task finishes in the same turn without step-budget checkpoints.',
  source: 'Approved continuous interactive task; bounded continuation regressions remain in core/progress-budget.test.ts',
  tags: ['long-task'],
  inbound: { text: '把 n0 到 n3 四条笔记都写上 x', sender: { id: 'master', roles: ['master'] } },
  agentConfig: { maxIterations: 2, toolBudget: { extendBy: 0, autoContinue: 'master_dm', maxContinuations: 1, progressMaxUpdates: 0 } },
  tools: [{ name: 'edit_note', result: (args: Record<string, unknown>) => `written ${String(args.id)}` }],
  script: [
    { toolCalls: [{ name: 'edit_note', args: { id: 'n0' } }] },
    { toolCalls: [{ name: 'edit_note', args: { id: 'n1' } }] },
    { toolCalls: [{ name: 'edit_note', args: { id: 'n2' } }] },
    { toolCalls: [{ name: 'edit_note', args: { id: 'n3' } }] },
    { text: '四条笔记都写好了。' },
  ],
  expect: {
    outboundContains: ['四条笔记都写好了'],
    modelInputNotContains: ['Automatic continuation', 'tool-call steps', 'One step left'],
    toolsCalled: ['edit_note'],
    modelSteps: 5,
  },
});
