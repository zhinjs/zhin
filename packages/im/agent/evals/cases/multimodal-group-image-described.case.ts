import { defineEvalCase, live } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

export default defineEvalCase({
  id: 'multimodal-group-image-described',
  description: 'A group member posts an image with an @mention and no question; the image reaches a vision model and the reply describes it.',
  source: '#769 Gemini switch: Gemini models were text-only by default, so group images were replaced by a text placeholder',
  tags: ['multimodal'],
  modelInput: ['text', 'image'],
  inbound: { text: '@bot 看看这个', scope: 'group', sender: { id: 'bob', roles: ['user'] }, images: [RED_CIRCLE_PNG] },
  script: [{ text: '这是一个白底上的红色圆形。' }],
  expect: { modelImages: [1], outboundContains: ['红色圆形'], modelSteps: 1 },
  live: {
    checks: (run) => [
      live.imagesSent(run, 1),
      live.replyMatches(run, /红|red/i, 'reply names the colour'),
      live.replyMatches(run, /圆|circle|round|disc/i, 'reply names the shape'),
      live.turnsCompleted(run),
    ],
  },
});
