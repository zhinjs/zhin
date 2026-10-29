import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'spin-varied-results-no-hint',
  description: 'Three searches that each return something new do not trigger the spin hint.',
  source: 'ADR 0042 §7: spin detection must not fire on real progress',
  tags: ['long-task', 'context'],
  inbound: { text: '这几个常量在哪？', sender: { id: 'master', roles: ['master'] } },
  workspace: { 'a.ts': 'export const alpha = 1;\n', 'b.ts': 'export const beta = 2;\n', 'c.ts': 'export const gamma = 3;\n' },
  nativeTools: ['grep'],
  script: [
    { toolCalls: [{ name: 'grep', args: { pattern: 'alpha' } }] },
    { toolCalls: [{ name: 'grep', args: { pattern: 'beta' } }] },
    { toolCalls: [{ name: 'grep', args: { pattern: 'gamma' } }] },
    { text: 'alpha 在 a.ts，beta 在 b.ts，gamma 在 c.ts。' },
  ],
  expect: {
    toolsCalled: ['grep'],
    modelInputNotContains: ['returned nothing new', 'Harness note'],
    modelSteps: 4,
  },
});
