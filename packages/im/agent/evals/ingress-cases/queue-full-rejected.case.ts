import { defineIngressEvalCase } from '../framework/index.js';

export default defineIngressEvalCase({
  id: 'queue-full-rejected',
  description: 'Past maxQueuedTurns a new member message is rejected with a notice instead of queuing without bound.',
  source: '#725 same-session admission (PR #746)',
  turnMs: 1000,
  gate: { maxQueuedTurns: 2 },
  messages: [
    { at: 0, sender: { id: 'u1' }, text: '问题 1' },
    { at: 10, sender: { id: 'u2' }, text: '问题 2' },
    { at: 20, sender: { id: 'u3' }, text: '问题 3' },
    { at: 30, sender: { id: 'u4' }, text: '问题 4' },
  ],
  expect: {
    rejected: ['u4:queue_full'],
    notices: ['前面还有几条消息在处理，请稍后再发。'],
    turns: [
      { sender: 'u1', status: 'completed' },
      { sender: 'u2', status: 'completed' },
      { sender: 'u3', status: 'completed' },
    ],
  },
});
