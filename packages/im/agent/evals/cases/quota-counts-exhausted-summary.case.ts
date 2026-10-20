import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'quota-counts-exhausted-summary',
  description: 'The tools-off summary after exhausting the tool budget contributes to the completed turn usage.',
  source: '#821 user-journey reliability audit: exhausted-turn summary usage was omitted',
  tags: ['quota', 'long-task'],
  agentConfig: {
    maxIterations: 1,
    usageQuota: { perUserTokens: 100 },
    toolBudget: { extendBy: 0, autoContinue: 'off', progressMaxUpdates: 0 },
  },
  inbound: [{ text: '整理一下依赖' }, { text: '继续整理' }],
  tools: [{ name: 'list_packages', result: 'package-a' }],
  script: [
    { toolCalls: [{ name: 'list_packages' }], tokens: 60 },
    { text: '已检查依赖，还需要继续核对。', tokens: 50 },
  ],
  expect: {
    toolsCalled: ['list_packages'],
    outboundContains: ['已检查依赖', 'AI 用量已达上限'],
    modelSteps: 2,
  },
});
