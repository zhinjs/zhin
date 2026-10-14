import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'told-ledger-carried',
  description: 'Conclusions and commitments from the previous reply reach the next turn as a short "already told" block.',
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
    modelInputContains: [
      '[Already told the user]',
      '- (conclusion) 周报周五 18:00 前交。',
      '- (commitment) 我会在周五上午提醒你。',
    ],
    outboundMessages: 2,
    modelSteps: 2,
  },
});
