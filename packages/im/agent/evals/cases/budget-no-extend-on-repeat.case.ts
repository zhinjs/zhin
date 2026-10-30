import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'budget-no-extend-on-repeat',
  description: 'Identical results stop a continuous task with an unfinished notice and no paid recovery.',
  source: '#718 progress-aware budget (looping must not earn more steps)',
  tags: ['long-task'],
  inbound: { text: '看看服务状态' },
  agentConfig: { maxIterations: 3, toolBudget: { extendBy: 3, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'service_status', result: 'status: degraded' }],
  script: [
    { toolCalls: [{ name: 'service_status', args: { id: 'api' } }] },
    { toolCalls: [{ name: 'service_status', args: { id: 'api' } }] },
    { toolCalls: [{ name: 'service_status', args: { id: 'api' } }] },
  ],
  expect: {
    outboundContains: ['任务未完成', '已暂停'],
    modelSteps: 3,
  },
});
