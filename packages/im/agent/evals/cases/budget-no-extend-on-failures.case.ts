import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'budget-no-extend-on-failures',
  description: 'Repeated failures stop a continuous task without spending another model request or leaking raw errors.',
  source: '#718 progress-aware budget (failure streaks must not earn more steps)',
  tags: ['long-task', 'tool-use'],
  inbound: { text: '部署一下最新版本' },
  agentConfig: { maxIterations: 3, toolBudget: { extendBy: 3, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'deploy_release', error: 'ECONNREFUSED 10.0.0.12:8443 deploy-gateway unreachable' }],
  script: [
    { toolCalls: [{ name: 'deploy_release', args: { attempt: 1 } }] },
    { toolCalls: [{ name: 'deploy_release', args: { attempt: 2 } }] },
    { toolCalls: [{ name: 'deploy_release', args: { attempt: 3 } }] },
  ],
  expect: {
    toolsCalled: ['deploy_release'],
    outboundContains: ['任务未完成', '已暂停'],
    outboundNotContains: ['10.0.0.12'],
    modelSteps: 3,
  },
});
