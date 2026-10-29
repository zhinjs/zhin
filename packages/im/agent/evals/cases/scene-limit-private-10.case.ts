import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'scene-limit-private-10',
  description: 'An ordinary private chat gets 10 model calls by default.',
  source: 'ADR 0042 §7: scene-based iteration limits (group 6, private 10, master private 15)',
  tags: ['long-task', 'tool-use'],
  inbound: { text: '把 r0 到 r15 都查一遍', sender: { id: 'carol', roles: ['user'] } },
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
    { toolCalls: [{ name: 'lookup', args: { id: 'r6' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r7' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r8' } }] },
    { toolCalls: [{ name: 'lookup', args: { id: 'r9' } }] },
    { text: '查了 r0 到 r9，剩下的要继续吗？' },
  ],
  expect: {
    outboundContains: ['要继续吗'],
    requestInputContains: { 10: ['One step left: reply now'] },
    modelSteps: 11,
  },
});
