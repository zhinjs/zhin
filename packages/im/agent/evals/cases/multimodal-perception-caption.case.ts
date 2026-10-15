import { defineEvalCase } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

export default defineEvalCase({
  id: 'multimodal-perception-caption',
  description: 'A text-only main model gets an image as a perception-model description instead of a placeholder; a later text turn can still refer to it (the description is persisted, the bytes are not).',
  source: 'ai.multimodal.perception pre-pass — text-only models (e.g. Groq gpt-oss) only saw "[Media unsupported:provider_input: image]"',
  tags: ['multimodal', 'memory'],
  perception: {},
  inbound: [
    { text: '@bot 看看这个', scope: 'group', sender: { id: 'bob', roles: ['user'] }, images: [RED_CIRCLE_PNG] },
    { text: '@bot 刚才那张图是什么颜色？', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
  ],
  script: [
    { model: 'scripted-perception', text: '白底上一个红色圆形。' },
    { model: 'scripted-model', text: '图里是白底上的一个红色圆形。' },
    { model: 'scripted-model', text: '是红色的。' },
  ],
  expect: {
    modelIds: ['scripted-perception', 'scripted-model', 'scripted-model'],
    // The perception model gets the image; the text-only main model never does.
    modelImages: [1, 0, 0],
    requestInputContains: {
      2: ['[图片描述]', '白底上一个红色圆形', 'source=external_content'],
      3: ['[图片描述]', '白底上一个红色圆形'],
    },
    modelInputNotContains: ['[Media unsupported'],
    outboundContains: ['红色圆形', '是红色的'],
    modelSteps: 3,
  },
});
