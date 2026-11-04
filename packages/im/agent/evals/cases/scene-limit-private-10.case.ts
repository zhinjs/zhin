import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'continuous-private-beyond-old-limit',
  description: 'An interactive private task completes all 16 lookups beyond its old scene cap.',
  source: 'ADR 0042 §7: scene-based iteration limits (group 6, private 10, master private 15)',
  tags: ['long-task', 'tool-use'],
  inbound: { text: '把 r0 到 r15 都查一遍', sender: { id: 'carol', roles: ['user'] } },
  // The old scene and configured caps must not terminate an admitted interactive task.
  agentConfig: { maxIterations: 15, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
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
    { toolCalls: [{ name: 'lookup', args: { id: 'r8' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r9' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r10' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r11' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r12' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r13' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r14' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r15' } }] },
    { text: '全部 16 条记录已查完。' },
  ],
  expect: {
    outboundContains: ['全部 16 条记录已查完'],
    modelInputNotContains: ['One step left: reply now', 'tool-call steps'],
    modelSteps: 17,
  },
});
