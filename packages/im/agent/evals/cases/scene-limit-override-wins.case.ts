import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'scene-limit-override-wins',
  description: 'A modelHarness maxIterations override beats the group scene default of 6.',
  source: 'ADR 0042 §7: scene-based iteration limits (group 6, private 10, master private 15)',
  tags: ['long-task', 'tool-use'],
  inbound: { text: '@bot 把 r0 到 r7 都查一遍', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
  // 15 is the stock default, so the scene default decides the limit.
  agentConfig: { maxIterations: 15, modelHarness: { models: { 'scripted-model': { maxIterations: 12 } } }, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'lookup', description: 'Look up one record.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, result: (args: Record<string, unknown>) => `record ${String(args.id)}` }],
  script: [
    { toolCalls: [{ name: 'lookup', args: { id: 'r0' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r1' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r2' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r3' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r4' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r5' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r6' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r7' } }] },
    { text: 'r0 到 r7 都查完了。' },
  ],
  expect: {
    outboundContains: ['都查完了'],
    modelInputNotContains: ['tool-call steps'],
    modelSteps: 9,
  },
});
