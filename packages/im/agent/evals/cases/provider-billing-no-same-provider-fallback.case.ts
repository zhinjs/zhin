import { defineEvalCase } from '../framework/index.js';

/**
 * DeepSeek answers an empty balance with 402 "Insufficient Balance". The fallback
 * candidate sits on the same provider alias, i.e. the same API key and account, so
 * trying it cannot help: no retry, no fallback, and the user is told why.
 */
export default defineEvalCase({
  id: 'provider-billing-no-same-provider-fallback',
  description: 'A 402 out-of-credit error is not retried and does not fall back to a candidate on the same provider alias; the user gets the billing message.',
  source: '#724 provider resilience: 402 / out of credit → no pointless same-key fallback',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  models: ['scripted-fallback'],
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: 'Insufficient Balance', status: 402, body: { error: { message: 'Insufficient Balance', type: 'unknown_error', param: null, code: 'invalid_request_error' } } } },
  ],
  expect: {
    modelIds: ['scripted-model'],
    outboundContains: ['余额不足'],
    outboundNotContains: ['Insufficient Balance', '请稍后再试'],
    termination: 'turn_end',
    modelSteps: 1,
  },
});
