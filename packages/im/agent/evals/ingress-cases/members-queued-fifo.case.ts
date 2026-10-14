import { defineIngressEvalCase } from '../framework/index.js';

export default defineIngressEvalCase({
  id: 'members-queued-fifo',
  description: 'Different members never abort or merge into each other; their turns run one at a time in arrival order.',
  source: '#725 same-session admission (PR #746)',
  turnMs: 1000,
  messages: [
    { at: 0, sender: { id: 'alice' }, text: 'A 的问题' },
    { at: 100, sender: { id: 'carol' }, text: 'C 的问题' },
    { at: 200, sender: { id: 'bob' }, text: 'B 的问题' },
  ],
  expect: {
    turns: [
      { sender: 'alice', text: 'A 的问题', status: 'completed' },
      { sender: 'carol', text: 'C 的问题', status: 'completed', mergedMessages: 1, supersededPrevious: false },
      { sender: 'bob', text: 'B 的问题', status: 'completed' },
    ],
    merged: [],
    rejected: [],
  },
});
