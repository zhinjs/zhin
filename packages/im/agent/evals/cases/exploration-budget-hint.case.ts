import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'exploration-budget-hint',
  description: 'Fresh research is not forced to finish by a read-count hint in continuous interactive turns.',
  source: 'QQ: the model explored file after file without acting (#716 exploration harness)',
  tags: ['long-task', 'context'],
  inbound: { text: '把 config.ts 里的端口改成 8080', sender: { id: 'master', roles: ['master'] } },
  agentConfig: { modelHarness: { models: { 'scripted-model': { explorationBudget: 2 } } } },
  workspace: { 'a.ts': 'a\n', 'b.ts': 'b\n', 'config.ts': 'export const port = 3000;\n' },
  nativeTools: ['read_file', 'edit_file'],
  script: [
    { toolCalls: [{ name: 'read_file', args: { file_path: 'a.ts' } }] },
    { toolCalls: [{ name: 'read_file', args: { file_path: 'b.ts' } }] },
    { toolCalls: [{ name: 'read_file', args: { file_path: 'config.ts' } }] },
    { toolCalls: [{ name: 'edit_file', args: { file_path: 'config.ts', old_string: '3000', new_string: '8080' } }] },
    { text: '端口已改成 8080。' },
  ],
  expect: {
    toolsCalled: ['edit_file'],
    modelInputNotContains: ['Stop exploring broadly', 'One step left'],
    outboundContains: ['8080'],
    modelSteps: 5,
  },
});
