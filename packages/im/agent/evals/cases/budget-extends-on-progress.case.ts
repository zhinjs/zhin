import { defineEvalCase } from '../framework/index.js';

/** #718: the soft tool budget extends while each step makes distinct progress. */
export default defineEvalCase({
  id: 'budget-extends-on-progress',
  description: 'A five-note edit runs past maxIterations=3 because every step makes new progress.',
  tags: ['long-task', 'tool-use'],
  inbound: { text: '把 n0 到 n4 五条笔记都写上 x', sender: { id: 'master', roles: ['master'] } },
  agentConfig: {
    maxIterations: 3,
    toolBudget: { extendBy: 3, autoContinue: 'off', progressMaxUpdates: 0 },
  },
  tools: [{ name: 'edit_note', description: 'Write a short note.', result: 'written' }],
  script: [
    ...[0, 1, 2, 3, 4].map((index) => ({ toolCalls: [{ name: 'edit_note', args: { id: `n${index}`, content: 'x' } }] })),
    { text: '五条笔记都已写好。' },
  ],
  expect: {
    toolsCalled: ['edit_note'],
    outboundContains: ['五条笔记都已写好'],
    termination: 'turn_end',
    modelSteps: 6,
  },
});
