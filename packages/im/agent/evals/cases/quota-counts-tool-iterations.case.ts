import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'quota-counts-tool-iterations',
  description: 'A turn charges both the tool-selection request and the final answer, so its next turn sees the full usage.',
  source: '#821 user-journey reliability audit: multi-request turns reported only their last completion usage',
  tags: ['quota', 'tool-use'],
  agentConfig: { usageQuota: { perUserTokens: 100 } },
  inbound: [{ text: '查询天气' }, { text: '再查询一次' }],
  tools: [{ name: 'lookup_weather', result: 'sunny' }],
  script: [
    { toolCalls: [{ name: 'lookup_weather' }], tokens: 60 },
    { text: '今天晴天。', tokens: 50 },
  ],
  expect: {
    toolsCalled: ['lookup_weather'],
    outboundContains: ['今天晴天', 'AI 用量已达上限'],
    modelSteps: 2,
  },
});
