import { defineEvalCase } from '../framework/index.js';

const LONG_NOTES = '会议纪要：'.concat('讨论了发布计划和回归测试的安排。'.repeat(400));

export default defineEvalCase({
  id: 'compaction-keeps-told',
  description: 'Auto-compaction triggers on a plugin-runtime session at the threshold, and its summary request is told to keep what the user was already told.',
  source: '#730 M2.4: compaction only ran near the hard window limit and could drop conclusions already given to the user',
  tags: ['context', 'memory', 'long-task'],
  contextWindow: 8000,
  agentConfig: {
    compaction: { keepRecentTokens: 200, minKeepCount: 1, thresholdRatio: 0.7 },
  },
  inbound: [
    { text: LONG_NOTES },
    { text: '结论是什么来着？' },
  ],
  script: [
    { text: '结论：发布推迟到下周三。' },
    { text: '摘要：用户贴了会议纪要。Already told the user：发布推迟到下周三。' },
    { text: '之前说过：发布推迟到下周三。' },
  ],
  expect: {
    anySystemPromptContains: ['Already told the user', '发布推迟到下周三'],
    outboundContains: ['之前说过：发布推迟到下周三'],
    outboundNotContains: ['摘要：'],
    modelSteps: 3,
  },
});
