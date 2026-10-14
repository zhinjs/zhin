import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'exhausted-summary-fallback',
  description: 'If the exhausted-turn summary request itself fails, the user gets the fixed notice, not tool output.',
  source: '#716 H1 fallback path',
  tags: ['long-task'],
  inbound: { text: '整理一下这个仓库的依赖' },
  agentConfig: { maxIterations: 1, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'list_packages', result: JSON.stringify({ packages: ['@zhin.js/agent', '@zhin.js/ai', '@zhin.js/core'], total: 95 }) }],
  script: [
    { toolCalls: [{ name: 'list_packages' }] },
    { fault: { kind: 'error', message: 'summary request failed', status: 500 } },
  ],
  expect: {
    outboundContains: ['步数已经用完'],
    noRawToolOutput: true,
    termination: 'turn_end',
    modelSteps: 2,
  },
});
