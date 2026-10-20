import { defineIngressEvalCase } from '../framework/index.js';

export default defineIngressEvalCase({
  id: 'master-cancel-stops-member',
  description: 'The master can stop a member turn that is running.',
  source: '#725 same-session admission (PR #746)',
  turnMs: 1000,
  messages: [
    { at: 0, sender: { id: 'mallory' }, text: '一直循环输出' },
    { at: 100, sender: { id: 'owner', roles: ['master'] }, text: '/cancel' },
  ],
  expect: {
    stops: ['owner:stopped'],
    turns: [{ sender: 'mallory', status: 'cancelled' }],
  },
});
