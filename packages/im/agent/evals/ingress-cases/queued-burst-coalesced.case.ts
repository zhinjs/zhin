import { defineIngressEvalCase } from '../framework/index.js';

export default defineIngressEvalCase({
  id: 'queued-burst-coalesced',
  description: 'While another member is being answered, a burst from one sender is merged into a single queued turn.',
  source: '#725 same-session admission (PR #746)',
  turnMs: 1000,
  messages: [
    { at: 0, sender: { id: 'alice' }, text: '总结一下今天的讨论' },
    { at: 100, sender: { id: 'bob' }, text: '我也有个问题' },
    { at: 200, sender: { id: 'bob' }, text: '部署脚本在哪' },
    { at: 300, sender: { id: 'bob' }, text: '谢谢' },
  ],
  expect: {
    turns: [
      { sender: 'alice', status: 'completed' },
      { sender: 'bob', status: 'completed', text: '我也有个问题\n部署脚本在哪\n谢谢', mergedMessages: 3 },
    ],
    merged: ['bob:部署脚本在哪', 'bob:谢谢'],
  },
});
