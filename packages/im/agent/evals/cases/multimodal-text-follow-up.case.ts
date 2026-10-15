import { defineEvalCase, live } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

export default defineEvalCase({
  id: 'multimodal-text-follow-up',
  description: 'After an image turn, a text-only follow-up is answered from the conversation; the image is not re-sent (media stays out of persisted history).',
  source: '#769 Gemini switch: image turn followed by a text question about it',
  tags: ['multimodal', 'memory'],
  modelInput: ['text', 'image'],
  inbound: [
    { text: '@bot 记住这张图', scope: 'group', sender: { id: 'bob', roles: ['user'] }, images: [RED_CIRCLE_PNG] },
    { text: '@bot 刚才那张图里是什么形状？', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
  ],
  script: [
    { text: '记住了：白底上一个红色圆形。' },
    { text: '是一个圆形。' },
  ],
  expect: { modelImages: [1, 0], outboundContains: ['是一个圆形'], modelSteps: 2 },
  live: {
    checks: (run) => [
      live.imagesSent(run, 1),
      live.lastReplyMatches(run, /圆|circle|round/i, 'follow-up answer names the shape'),
      live.turnsCompleted(run),
    ],
  },
});
