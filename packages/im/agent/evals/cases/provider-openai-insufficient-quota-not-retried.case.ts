import { defineEvalCase } from '../framework/index.js';

/** OpenAI reports an exhausted billing quota as a 429, but retrying it only wastes time. */
const INSUFFICIENT_QUOTA = {
  error: {
    message: 'You exceeded your current quota, please check your plan and billing details.',
    type: 'insufficient_quota',
    param: null,
    code: 'insufficient_quota',
  },
};

export default defineEvalCase({
  id: 'provider-openai-insufficient-quota-not-retried',
  description: 'An OpenAI 429 insufficient_quota is not retried like a rate limit; the owner is told the account is out of credit.',
  source: '#724 provider audit S19: OpenAI insufficient_quota retried uselessly',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候', sender: { id: 'owner', roles: ['master'] } },
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: INSUFFICIENT_QUOTA.error.message, status: 429, body: INSUFFICIENT_QUOTA } },
  ],
  expect: {
    modelIds: ['scripted-model'],
    outboundContains: ['（模型账户欠费）'],
    outboundNotContains: ['exceeded your current quota', '限流'],
    termination: 'turn_end',
    modelSteps: 1,
  },
});
