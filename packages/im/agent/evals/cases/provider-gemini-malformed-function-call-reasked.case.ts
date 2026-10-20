import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-gemini-malformed-function-call-reasked',
  description: 'With the Gemini preset (emptyReplyRetries: 1), a MALFORMED_FUNCTION_CALL finish is re-asked once on the same model.',
  source: '#724 provider resilience, Gemini primary (#770): MALFORMED_FUNCTION_CALL → re-ask (model-harness preset)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  models: ['scripted-fallback'],
  // The scripted model id does not match the `gemini-` preset, so opt in the same way the preset does.
  agentConfig: { modelHarness: { models: { 'scripted-model': { emptyReplyRetries: 1 } } } },
  script: [
    { model: 'scripted-model', fault: { kind: 'finish', finishReason: 'error', raw: 'MALFORMED_FUNCTION_CALL' } },
    { model: 'scripted-model', text: '早上好，愿你今天心情明朗！' },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-model'],
    outboundContains: ['早上好，愿你今天心情明朗'],
    outboundNotContains: ['MALFORMED_FUNCTION_CALL', '无法解析'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
