import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'auto-continuation-master-dm',
  description: 'In a master DM, a progressing turn that runs out of steps continues automatically instead of stopping.',
  source: '#718 auto-continuation (default: master private chat)',
  tags: ['long-task'],
  inbound: { text: '把 n0 到 n3 四条笔记都写上 x', sender: { id: 'master', roles: ['master'] } },
  agentConfig: { maxIterations: 2, toolBudget: { extendBy: 0, autoContinue: 'master_dm', maxContinuations: 1, progressMaxUpdates: 0 } },
  tools: [{ name: 'edit_note', result: (args: Record<string, unknown>) => `written ${String(args.id)}` }],
  script: [
    { toolCalls: [{ name: 'edit_note', args: { id: 'n0' } }] },
    { toolCalls: [{ name: 'edit_note', args: { id: 'n1' } }] },
    // Budget spent while progressing: the harness asks for a checkpoint summary (tools off)…
    { text: '已写好 n0、n1，继续写剩下的。' },
    // …then resumes the same turn with tools.
    { toolCalls: [{ name: 'edit_note', args: { id: 'n2' } }] },
    { toolCalls: [{ name: 'edit_note', args: { id: 'n3' } }] },
    { text: '四条笔记都写好了。' },
  ],
  expect: {
    outboundContains: ['四条笔记都写好了'],
    modelInputContains: ['Automatic continuation 1/1'],
    toolsCalled: ['edit_note'],
    modelSteps: 6,
  },
});
