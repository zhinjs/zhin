import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'unknown-tool-hinted',
  description: 'A call to a tool that does not exist is rejected with a discover/load_tool hint and nothing runs.',
  source: 'QQ: model invented a tool name and the turn looped on "Unknown tool" (#716 core-tools-loaded)',
  tags: ['tool-use'],
  inbound: { text: '查一下 AAPL 的股价' },
  tools: [{ name: 'get_weather', description: 'Look up current weather for a city.' }],
  script: [
    { toolCalls: [{ name: 'get_stock_price', args: { symbol: 'AAPL' }, notOffered: true }] },
    { text: '我这里没有查询股价的工具，暂时没法帮你查 AAPL。' },
  ],
  expect: {
    toolsNotCalled: ['get_weather'],
    modelInputContains: ['get_stock_price'],
    outboundContains: ['没有查询股价的工具'],
    modelSteps: 2,
  },
});
