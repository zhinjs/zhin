import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'context-compact-prompt-tool-reply',
  description: 'Compact instructions retain a group member tool lookup and structured final reply in two model requests.',
  source: '#949: reduce fixed instructions without hiding tools or adding intent classification',
  tags: ['context', 'tool-use'],
  inbound: { text: '今天上海天气怎么样？', scope: 'group' },
  tools: [{
    name: 'get_weather', description: 'Look up current weather for a city.',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    result: { city: '上海', weather: '晴', temperature: 24 },
  }],
  script: [
    { toolCalls: [{ name: 'get_weather', args: { city: '上海' } }] },
    { text: '上海晴，24°C。' },
  ],
  expect: {
    toolsCalled: ['get_weather'], outboundContains: ['上海', '24°C'], modelSteps: 2,
    systemPromptContains: ['# Security', 'ZHIN_NEEDS_OWNER:', 'policyBlocked'],
    contextBudget: { maxSegmentTokens: { system: 1400 } },
  },
});
