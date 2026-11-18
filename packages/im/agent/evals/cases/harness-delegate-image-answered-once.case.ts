import { defineEvalCase } from '../framework/index.js';
import { RED_CIRCLE_PNG } from '../fixtures/images.js';

// #1250 delegate-result-double-reply (owner replay): a Sandbox DM with an image, "画的是什么，一句话回答". The entry
// agent delegates to `vision`. Before the fix `delegate` returned in 5 ms, the entry model answered on its own
// and ~10 s later the result mail woke it again: two near-identical replies and one extra model call. Now a
// short delegation waits for the result within the turn: the entry model answers once, from vision's result.
export default defineEvalCase({
  id: 'harness-delegate-image-answered-once',
  description: 'A short delegation (an image question) waits for its result in the turn: one reply, no second wake-up.',
  source: '#1250 delegate-result-double-reply',
  tags: ['collaboration', 'multimodal'],
  modelInput: ['text', 'image'],
  inbound: { text: '画的是什么，一句话回答', images: [RED_CIRCLE_PNG], sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  agents: [{ name: 'vision', description: 'Inbound image analysis—describe, OCR, answer what is visible.', tools: [] }],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'vision', brief: '用户发了一张图，问画的是什么，一句话回答。' } }] },
    { actor: 'vision', text: '白底上画着一个红色的圆。' },
    { text: '画的是白底上的一个红色圆形。' },
    // Trap: a second answer of the same request, woken by a result mail.
    { text: '图里是一个红色的圆。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['画的是白底上的一个红色圆形。'],
    outboundNotContains: ['图里是一个红色的圆', '补充'],
    outboundMessages: 1,
    // The entry model read vision's result in the delegate tool result, not in a later result mail.
    modelInputContains: ['agent vision finished (completed', '白底上画着一个红色的圆'],
    modelInputNotContains: ['[mail from vision · result]'],
    // entry: delegate, answer; vision: one call. The trap is never requested.
    modelSteps: 3,
  },
});
