import { defineEvalCase } from '../framework/index.js';

const RAW_WEATHER = JSON.stringify({ city: 'Shanghai', condition: 'light rain', tempC: 18, humidity: 0.82, station: 'ZSSS-0042' });

export default defineEvalCase({
  id: 'tool-result-summarized',
  description: 'Private chat: the agent calls a tool and replies in prose without echoing the raw tool payload.',
  tags: ['tool-use'],
  inbound: { text: '上海今天天气怎么样？' },
  tools: [
    { name: 'get_weather', description: 'Look up current weather for a city.', result: RAW_WEATHER },
    { name: 'send_message', description: 'Send a message to another conversation.' },
  ],
  script: [
    { toolCalls: [{ name: 'get_weather', args: { city: 'Shanghai' } }] },
    { text: '上海今天小雨，18°C 左右，记得带伞。' },
  ],
  expect: {
    toolsCalled: ['get_weather'],
    toolsNotCalled: ['send_message'],
    outboundContains: ['小雨', '18°C'],
    outboundNotContains: ['ZSSS-0042'],
    noRawToolOutput: true,
    approvalRequested: false,
    termination: 'turn_end',
    modelSteps: 2,
  },
});
