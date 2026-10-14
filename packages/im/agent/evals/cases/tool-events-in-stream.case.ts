import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'tool-events-in-stream',
  description: 'With the real AgentCore, tool call/result events reach stream consumers via the journal-derived feed, exactly once.',
  source: '#748 (finding 2 of #740): authority tool events were journaled but missing from the engine stream',
  tags: ['tool-use'],
  inbound: { text: '上海今天天气怎么样？' },
  tools: [{ name: 'get_weather', description: 'Look up current weather for a city.', result: 'light rain, 18C' }],
  script: [
    { toolCalls: [{ name: 'get_weather', args: { city: 'Shanghai' } }] },
    { text: '上海今天小雨，18°C。' },
  ],
  expect: {
    toolsCalled: ['get_weather'],
    streamToolEvents: ['tool_call:get_weather', 'tool_result:get_weather'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
