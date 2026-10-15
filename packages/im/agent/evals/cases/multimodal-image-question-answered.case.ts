import { defineEvalCase, live } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

export default defineEvalCase({
  id: 'multimodal-image-question-answered',
  description: 'An image plus a specific question in a DM: the model answers the question about the image rather than describing it generically.',
  source: '#769 Gemini switch: image + question in one message',
  tags: ['multimodal'],
  modelInput: ['text', 'image'],
  inbound: { text: '图里的图形是什么颜色？只回答颜色。', images: [RED_CIRCLE_PNG] },
  script: [{ text: '红色' }],
  expect: { modelImages: [1], modelInputContains: ['图里的图形是什么颜色'], outboundContains: ['红色'], modelSteps: 1 },
  live: {
    checks: (run) => [
      live.imagesSent(run, 1),
      live.replyMatches(run, /红|red/i, 'reply answers with the colour'),
      live.replyNotMatches(run, /无法查看|看不到|can(?:'|no)t see|unable to view/i, 'model did not claim it cannot see the image'),
      live.turnsCompleted(run),
    ],
  },
});
