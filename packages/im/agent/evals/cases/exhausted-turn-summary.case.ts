import { defineEvalCase } from '../framework/index.js';

const RAW = 'match: packages/im/agent/src/core/agent-core-run.ts:412 const directTools = input.toolLoading';

export default defineEvalCase({
  id: 'exhausted-turn-summary',
  description: 'When the step budget runs out, tools are disabled and the model writes a summary; raw tool output is not sent.',
  source: 'QQ: iterations exhausted → user got a dump of tool output with no summary (#716 H1)',
  tags: ['long-task', 'tool-use'],
  inbound: { text: '帮我找出所有用到 toolLoading 的地方' },
  agentConfig: { maxIterations: 2, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'search_code', description: 'Search the codebase.', result: RAW }],
  script: [
    { toolCalls: [{ name: 'search_code', args: { q: 'toolLoading', page: 1 } }] },
    { toolCalls: [{ name: 'search_code', args: { q: 'toolLoading', page: 2 } }] },
    // Harness asks for a summary with tools disabled.
    { text: '已经查了两页结果，主要在 agent-core-run.ts；还有剩余结果没看完，要我继续吗？' },
  ],
  expect: {
    outboundContains: ['要我继续吗'],
    noRawToolOutput: true,
    modelInputContains: ['tool-call steps'],
    modelSteps: 3,
  },
});
