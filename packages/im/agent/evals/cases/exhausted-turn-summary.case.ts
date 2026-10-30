import { defineEvalCase } from '../framework/index.js';

const RAW = 'match: packages/im/agent/src/core/agent-core-run.ts:412 const directTools = input.toolLoading';

export default defineEvalCase({
  id: 'continuous-turn-completion',
  description: 'The model keeps its tools beyond the old budget and finishes without dumping raw tool output.',
  source: 'QQ: iterations exhausted → user got a dump of tool output with no summary (#716 H1)',
  tags: ['long-task', 'tool-use'],
  inbound: { text: '帮我找出所有用到 toolLoading 的地方' },
  agentConfig: { maxIterations: 2, toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 } },
  tools: [{ name: 'search_code', description: 'Search the codebase.', result: RAW }],
  script: [
    { toolCalls: [{ name: 'search_code', args: { q: 'toolLoading', page: 1 } }] },
    { toolCalls: [{ name: 'search_code', args: { q: 'toolLoading', page: 2 } }] },
    // The same interactive run reaches its natural final answer with tools still available.
    { text: '两页结果已查完，主要在 agent-core-run.ts。' },
  ],
  expect: {
    outboundContains: ['两页结果已查完'],
    noRawToolOutput: true,
    modelInputNotContains: ['tool-call steps', 'One step left'],
    modelSteps: 3,
  },
});
