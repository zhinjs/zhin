import { defineIngressEvalCase } from '../framework/index.js';

export default defineIngressEvalCase({
  id: 'cancel-stops-own-turn',
  description: 'The initiator can stop their running turn; another member cannot; queued turns of others still run.',
  source: '#725 same-session admission (PR #746)',
  turnMs: 1000,
  messages: [
    { at: 0, sender: { id: 'alice' }, text: '写一篇长文' },
    { at: 100, sender: { id: 'bob' }, text: 'B 的问题' },
    { at: 200, sender: { id: 'bob' }, text: '取消' },
    { at: 300, sender: { id: 'alice' }, text: '取消' },
  ],
  expect: {
    stops: ['bob:forbidden', 'alice:stopped'],
    notices: ['好的，已停止当前回复。'],
    turns: [
      { sender: 'alice', status: 'cancelled' },
      // bob's "取消" was not his to stop, so it was handled as an ordinary message and merged.
      { sender: 'bob', status: 'completed', text: 'B 的问题\n取消', mergedMessages: 2 },
    ],
  },
});
