import { defineEvalCase } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

export default defineEvalCase({
  id: 'provider-fallback-keeps-image-input',
  description: 'When an image-capable primary model fails, fallback skips a text-only candidate (which would silently turn the accepted image into a placeholder) and uses the next image-capable one.',
  source: 'ai.multimodal.perception PR — fallback candidates filtered by the input modalities the turn needs',
  tags: ['multimodal', 'long-task'],
  modelInput: ['text', 'image'],
  models: ['scripted-fallback', 'scripted-vision-fallback'],
  modelInputs: { 'scripted-fallback': ['text'] },
  agentConfig: { providerResilience: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  inbound: { text: '@bot 图里是什么？', scope: 'group', sender: { id: 'bob', roles: ['user'] }, images: [RED_CIRCLE_PNG] },
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: 'Service Unavailable', status: 503 } },
    { model: 'scripted-model', fault: { kind: 'error', message: 'Service Unavailable', status: 503 } },
    { model: 'scripted-vision-fallback', text: '白底上一个红色圆形。' },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-model', 'scripted-vision-fallback'],
    modelImages: [1, 1, 1],
    outboundContains: ['红色圆形'],
    modelSteps: 3,
  },
});
