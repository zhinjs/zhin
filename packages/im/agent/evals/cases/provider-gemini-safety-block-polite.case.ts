import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-gemini-safety-block-polite',
  description: 'A Gemini SAFETY finish is final: not re-asked, no fallback model, and the owner gets a short refusal saying the model blocked it.',
  source: '#724 provider resilience, Gemini primary (#770): safety block → no retry, no fallback',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候', sender: { id: 'owner', roles: ['master'] } },
  models: ['scripted-fallback'],
  // Even with an empty-reply re-ask enabled, a refusal is not re-asked.
  agentConfig: { modelHarness: { models: { 'scripted-model': { emptyReplyRetries: 1 } } } },
  script: [
    { model: 'scripted-model', fault: { kind: 'finish', finishReason: 'content-filter', raw: 'SAFETY' } },
  ],
  expect: {
    modelIds: ['scripted-model'],
    outboundContains: ['这个我不接', '（内容被模型拦截）'],
    outboundNotContains: ['模型调用失败', '请检查 API 密钥'],
    termination: 'turn_end',
    modelSteps: 1,
  },
});
