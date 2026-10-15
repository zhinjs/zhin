import { defineEvalCase } from '../framework/index.js';

const LONG_NOTES = '会议纪要：'.concat('讨论了发布计划和回归测试的安排。'.repeat(400));

/** Gemini's overflow wording; it carries no "context length" phrase. */
const OVERFLOW = {
  error: {
    code: 400,
    message: 'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).',
    status: 'INVALID_ARGUMENT',
  },
};

export default defineEvalCase({
  id: 'provider-gemini-context-overflow-compacted',
  description: 'A Gemini "input token count exceeds the maximum" 400 is recognised as a context overflow: no fallback, the history is compacted and the turn re-asked.',
  source: '#724 provider audit S2: one shared context-overflow detector (Gemini / Vertex / Anthropic wording)',
  tags: ['context', 'long-task'],
  agentConfig: {
    compaction: { keepRecentTokens: 200, minKeepCount: 1 },
  },
  inbound: [
    { text: LONG_NOTES },
    { text: '结论是什么来着？' },
  ],
  script: [
    { text: '结论：发布推迟到下周三。' },
    { fault: { kind: 'error', message: OVERFLOW.error.message, status: 400, body: OVERFLOW } },
    { text: '摘要：用户贴了会议纪要。Already told the user：发布推迟到下周三。' },
    { text: '之前说过：发布推迟到下周三。' },
  ],
  expect: {
    outboundContains: ['之前说过：发布推迟到下周三'],
    outboundNotContains: ['input token count', '模型调用失败', '拒绝了请求'],
    modelSteps: 4,
  },
});
