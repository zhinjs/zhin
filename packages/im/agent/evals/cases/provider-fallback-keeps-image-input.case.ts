import { defineEvalCase } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

export default defineEvalCase({
  id: 'provider-fallback-keeps-image-input',
  description: 'An image-capable fixed primary retains the image on each retry, then reports failure without calling text-only or image-capable alternatives.',
  source: '2026-10-30 approved fixed chat model policy; multimodal input survives same-model retry; perception fallback remains separate',
  tags: ['multimodal', 'long-task'],
  modelInput: ['text', 'image'],
  // Registered alternatives must never receive a chat request under the fixed-model policy.
  models: ['scripted-fallback', 'scripted-vision-fallback'],
  modelInputs: { 'scripted-fallback': ['text'] },
  agentConfig: { providerResilience: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  inbound: { text: '@bot 图里是什么？', scope: 'group', sender: { id: 'bob', roles: ['master'] }, images: [RED_CIRCLE_PNG] },
  script: [
    { model: 'scripted-model', fault: { kind: 'error', message: 'Service Unavailable', status: 503 } },
    { model: 'scripted-model', fault: { kind: 'error', message: 'Service Unavailable', status: 503 } },
  ],
  expect: {
    modelIds: ['scripted-model', 'scripted-model'],
    modelImages: [1, 1],
    outboundContains: ['（模型服务不可用）'],
    outboundNotContains: ['红色圆形', 'Service Unavailable', '模型调用失败'],
    termination: 'turn_end',
    modelSteps: 2,
  },
});
