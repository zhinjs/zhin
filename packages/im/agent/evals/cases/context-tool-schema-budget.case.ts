import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'context-tool-schema-budget',
  description: 'A large available tool schema reduces the history budget before the next turn.',
  source: '#952: include the full tool input schema in compaction admission',
  tags: ['context', 'tool-use'],
  workspace: {},
  contextWindow: 32_000,
  agentConfig: { compaction: { keepRecentTokens: 100, minKeepCount: 1 } },
  tools: [{ name: 'lookup', description: '查询', parameters: { type: 'object', properties: {
    query: { type: 'string', description: '字段说明'.repeat(3800) },
  } }, result: '查询结果' }],
  inbound: [
    { text: '旧纪要：'.concat('请保留时间和负责人。'.repeat(120)) },
    { text: '继续确认负责人。' },
  ],
  script: [
    { text: '已记录负责人。' },
    { text: '摘要：负责人待进一步确认。' },
    { text: '请继续补充负责人信息。' },
  ],
  expect: { modelSteps: 3, outboundContains: ['请继续补充负责人信息'],
    outboundNotContains: ['摘要：'], modelInputContains: ['[Previous conversation summary]'] },
});
