import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'continuous-provider-billing-stop',
  description: 'Provider billing exhaustion after tool use stops without an extra summary or leaking tool output.',
  source: 'Approved continuous execution: stop when provider credits run out; bounded exhaustion fallback remains covered in core tests',
  tags: ['long-task'],
  inbound: { text: '整理一下这个仓库的依赖', sender: { id: 'owner', roles: ['master'] } },
  agentConfig: { maxIterations: 1, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'list_packages', result: JSON.stringify({ packages: ['@zhin.js/agent', '@zhin.js/ai', '@zhin.js/core'], total: 95 }) }],
  script: [
    { toolCalls: [{ name: 'list_packages' }] },
    { fault: { kind: 'error', message: 'insufficient_quota', status: 402 } },
  ],
  expect: {
    outboundContains: ['（模型账户欠费）'],
    outboundNotContains: ['步数已经用完', 'insufficient_quota', 'packages'],
    noRawToolOutput: true,
    termination: 'turn_end',
    modelSteps: 2,
  },
});
