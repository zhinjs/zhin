import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'budget-no-extend-on-repeat',
  description: 'Repeating the identical call is not progress: the budget is not extended and the turn ends with a summary.',
  source: '#718 progress-aware budget (looping must not earn more steps)',
  tags: ['long-task'],
  inbound: { text: '看看服务状态' },
  agentConfig: { maxIterations: 3, toolBudget: { extendBy: 3, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'service_status', result: 'status: degraded' }],
  script: [
    { toolCalls: [{ name: 'service_status', args: { id: 'api' } }] },
    { toolCalls: [{ name: 'service_status', args: { id: 'api' } }] },
    { toolCalls: [{ name: 'service_status', args: { id: 'api' } }] },
    { text: '服务目前是 degraded 状态，我重复查了几次没有变化。' },
  ],
  expect: {
    outboundContains: ['degraded'],
    modelSteps: 4,
  },
});
