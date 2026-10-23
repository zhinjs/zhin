import { defineEvalCase } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

export default defineEvalCase({
  id: 'multimodal-perception-fallback',
  description: 'A blocked perception provider falls back to another visual model while the main conversation remains text-only.',
  source: 'Vision provider location restrictions must not make the bot blind when a configured backup is available.',
  tags: ['multimodal'],
  models: ['vision-backup'],
  modelInputs: { 'vision-backup': ['text', 'image'] },
  perception: { fallbacks: ['vision-backup'] },
  agentConfig: { providerResilience: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 } },
  inbound: { text: '@bot 这是什么颜色？', scope: 'group', images: [RED_CIRCLE_PNG] },
  script: [
    { model: 'scripted-perception', fault: { kind: 'error', message: 'Location unsupported', status: 400 } },
    { model: 'vision-backup', text: '白底上一个红色圆形。' },
    { model: 'scripted-model', text: '是红色的。' },
  ],
  expect: {
    modelIds: ['scripted-perception', 'vision-backup', 'scripted-model'],
    modelImages: [1, 1, 0],
    requestInputContains: { 3: ['[图片描述]', '白底上一个红色圆形', 'source=external_content'] },
    outboundContains: ['红色'],
    outboundNotContains: ['Location unsupported'],
    modelSteps: 3,
  },
});
