import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-empty-reply-reasked',
  description: 'With a quirk preset (emptyReplyRetries: 1, as MiniMax M-series ships) an empty reply is re-asked once.',
  source: '#724 provider resilience (empty reply, model-harness quirk preset)',
  tags: ['long-task'],
  inbound: { text: '帮我写一句早安问候' },
  agentConfig: { modelHarness: { models: { 'scripted-model': { emptyReplyRetries: 1 } } } },
  script: [
    { fault: { kind: 'empty' } },
    { text: '早上好，祝你今天顺利！' },
  ],
  expect: {
    outboundContains: ['早上好，祝你今天顺利'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
