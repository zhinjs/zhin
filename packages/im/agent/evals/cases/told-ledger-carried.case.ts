import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'told-ledger-carried',
  description: 'Visible delivered conclusions and commitments reach the next turn once, without a duplicate ledger block.',
  source: '#730 M2.5: the agent repeated or contradicted what it had already told the user',
  tags: ['context', 'memory'],
  inbound: [
    { text: '周报什么时候交？' },
    { text: '那你记得提醒我吗？' },
  ],
  script: [
    { text: '周报周五 18:00 前交。我会在周五上午提醒你。' },
    { text: '会的，周五上午提醒你。' },
  ],
  expect: {
    requestInputContains: { 2: ['周报周五 18:00 前交。', '我会在周五上午提醒你。'] },
    maxInputOccurrences: { '周报周五 18:00 前交。': 1, '我会在周五上午提醒你。': 1 },
    modelInputNotContains: ['[Already told the user]'],
    outboundMessages: 2,
    modelSteps: 2,
  },
});
