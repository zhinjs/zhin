import { defineIngressEvalCase } from '../framework/index.js';

export default defineIngressEvalCase({
  id: 'queued-turn-expires',
  description: 'A queued message older than queueTtlMs is skipped with a notice rather than answered late.',
  source: '#725 same-session admission (PR #746)',
  turnMs: 5000,
  gate: { queueTtlMs: 2000 },
  messages: [
    { at: 0, sender: { id: 'alice' }, text: '慢问题' },
    { at: 100, sender: { id: 'bob' }, text: '过时的问题' },
  ],
  expect: {
    rejected: ['bob:expired'],
    notices: ['这条消息排队太久，已跳过，需要的话请重新发送。'],
    turns: [{ sender: 'alice', status: 'completed' }],
  },
});
