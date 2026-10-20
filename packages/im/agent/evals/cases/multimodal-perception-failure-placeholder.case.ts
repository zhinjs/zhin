import { defineEvalCase } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

export default defineEvalCase({
  id: 'multimodal-perception-failure-placeholder',
  description: 'When the perception model fails, the turn still runs with the same placeholder as without perception (fail closed, no invented description).',
  source: 'ai.multimodal.perception pre-pass — perception failure must fall back to the placeholder',
  tags: ['multimodal'],
  perception: {},
  agentConfig: { providerResilience: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 } },
  inbound: { text: '@bot 看看这个', scope: 'group', sender: { id: 'bob', roles: ['user'] }, images: [RED_CIRCLE_PNG] },
  script: [
    { model: 'scripted-perception', fault: { kind: 'error', message: 'Service Unavailable', status: 503 } },
    { model: 'scripted-model', text: '我看不到图片内容。' },
  ],
  expect: {
    modelIds: ['scripted-perception', 'scripted-model'],
    modelImages: [1, 0],
    requestInputContains: { 2: ['[Media unsupported:provider_input: image'] },
    modelInputNotContains: ['[图片描述]'],
    outboundNotContains: ['Service Unavailable'],
    modelSteps: 2,
  },
});
