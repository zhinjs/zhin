import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-empty-reply-default',
  description: 'Without a quirk preset an empty reply is not re-asked (one request) and the user gets the existing empty-reply notice.',
  source: '#724 provider resilience (empty reply, default emptyReplyRetries: 0)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  script: [{ fault: { kind: 'empty' } }],
  expect: {
    termination: 'turn_end',
    modelSteps: 1,
    outboundContains: ['模型未返回可见内容'],
  },
});
