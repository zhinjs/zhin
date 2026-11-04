import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'continuous-group-beyond-old-limit',
  description: 'An interactive group task completes all 45 lookups beyond its old scene and total caps.',
  source: 'ADR 0042 §7: scene-based iteration limits (group 6, private 10, master private 15)',
  tags: ['long-task', 'tool-use'],
  inbound: { text: '@bot 把 r0 到 r44 都查一遍', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
  // The old scene and configured caps must not terminate an admitted interactive task.
  agentConfig: { maxIterations: 15, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'lookup', description: 'Look up one record.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, result: (args: Record<string, unknown>) => `record ${String(args.id)}` }],
  script: [
    ...Array.from({ length: 45 }, (_, index) => ({
      toolCalls: [{ name: 'lookup', args: { id: `r${index}` } }],
    })),
    { text: '全部 45 条记录已查完。' },
  ],
  expect: {
    outboundContains: ['全部 45 条记录已查完'],
    modelInputNotContains: ['One step left: reply now', 'tool-call steps'],
    modelSteps: 46,
  },
});
