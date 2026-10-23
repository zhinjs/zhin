import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'context-small-window-compaction',
  description: 'An 8K conversation compacts before the next request with the default recent-history budget.',
  source: '#952: small windows must not inherit a 25K compaction floor',
  tags: ['context', 'memory'],
  workspace: {},
  contextWindow: 8_192,
  inbound: [
    { text: '旧纪要：'.concat('请保留时间和负责人。'.repeat(400)) },
    { text: '补充：'.concat('继续确认测试安排。'.repeat(400)) },
  ],
  script: [
    { text: '已记录负责人和时间。' },
    { text: '会议摘要：保留时间和负责人，测试安排待确认。' },
    { text: '已根据纪要继续整理测试安排。' },
  ],
  expect: { modelSteps: 3, outboundContains: ['已根据纪要继续整理测试安排'],
    outboundNotContains: ['会议摘要：'], modelInputContains: ['[Previous conversation summary]'] },
});
