import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'scene-limit-group-6',
  description: 'A group turn gets 6 model calls by default; the 5th tool result tells the model one step is left, then tools are disabled.',
  source: 'ADR 0042 §7: scene-based iteration limits (group 6, private 10, master private 15)',
  tags: ['long-task', 'tool-use'],
  inbound: { text: '@bot 把 r0 到 r7 都查一遍', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
  // 15 is the stock default, so the scene default decides the limit.
  agentConfig: { maxIterations: 15, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'lookup', description: 'Look up one record.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, result: (args: Record<string, unknown>) => `record ${String(args.id)}` }],
  script: [
    { toolCalls: [{ name: 'lookup', args: { id: 'r0' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r1' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r2' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r3' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r4' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r5' } }] },
    { text: '查了 r0 到 r5，剩下的还没查，要继续吗？' },
  ],
  expect: {
    outboundContains: ['要继续吗'],
    modelInputContains: ['One step left: reply now', 'tool-call steps'],
    requestInputContains: { 6: ['One step left: reply now'] },
    modelSteps: 7,
  },
});
