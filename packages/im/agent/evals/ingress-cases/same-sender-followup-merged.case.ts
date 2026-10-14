import { defineIngressEvalCase } from '../framework/index.js';

export default defineIngressEvalCase({
  id: 'same-sender-followup-merged',
  description: 'A sender who adds to an unanswered question gets one reply covering both messages; the first turn is superseded.',
  source: '#725 same-session admission (PR #746)',
  turnMs: 1000,
  messages: [
    { at: 0, sender: { id: 'alice' }, text: '帮我查下明天的天气' },
    { at: 300, sender: { id: 'alice' }, text: '上海的' },
  ],
  expect: {
    turns: [
      { sender: 'alice', status: 'cancelled', mergedMessages: 1 },
      { sender: 'alice', status: 'completed', text: '帮我查下明天的天气\n上海的', mergedMessages: 2, supersededPrevious: true },
    ],
    rejected: [],
  },
});
