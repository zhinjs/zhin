import { defineEvalCase } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

export default defineEvalCase({
  id: 'multimodal-text-only-model-placeholder',
  description: 'A model that does not declare image input never receives image bytes; it gets a text placeholder instead (fail closed).',
  source: '#769 Gemini switch: the guard that made images vanish must stay for text-only models',
  tags: ['multimodal'],
  inbound: { text: '@bot 看看这个', scope: 'group', sender: { id: 'bob', roles: ['user'] }, images: [RED_CIRCLE_PNG] },
  script: [{ text: '我看不到图片内容。' }],
  expect: { modelImages: [0], modelSteps: 1 },
});
