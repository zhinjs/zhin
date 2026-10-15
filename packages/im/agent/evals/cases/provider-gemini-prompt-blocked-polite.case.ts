import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-gemini-prompt-blocked-polite',
  description: 'A Gemini prompt block (promptFeedback.blockReason, no candidates) is not resent to a fallback model; the user gets a polite refusal.',
  source: '#724 provider resilience, Gemini primary (#770): blocked prompt → no retry, no fallback',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  models: ['scripted-fallback'],
  script: [
    { model: 'scripted-model', fault: { kind: 'finish', finishReason: 'other', blockReason: 'PROHIBITED_CONTENT' } },
  ],
  expect: {
    modelIds: ['scripted-model'],
    outboundContains: ['抱歉', '内容安全策略', 'PROHIBITED_CONTENT'],
    outboundNotContains: ['模型调用失败'],
    termination: 'turn_end',
    modelSteps: 1,
  },
});
