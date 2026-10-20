import { defineEvalCase, live } from '../framework/index.js';

export default defineEvalCase({
  id: 'session-history-carried',
  description: 'A follow-up turn in the same private session sees the previous exchange.',
  source: 'QQ: follow-up questions lost the previous turn (baseline for #730 compaction / told-ledger)',
  tags: ['context', 'memory'],
  inbound: [
    { text: '记住，我的项目代号叫“青鸟”。' },
    { text: '我的项目代号是什么？' },
  ],
  script: [
    { text: '好的，记住了：项目代号“青鸟”。' },
    { text: '你的项目代号是“青鸟”。' },
  ],
  expect: {
    modelInputContains: ['好的，记住了：项目代号“青鸟”。'],
    outboundContains: ['你的项目代号是“青鸟”'],
    outboundMessages: 2,
    modelSteps: 2,
  },
  live: { checks: (run) => [live.lastReplyMatches(run, /青鸟/, 'second reply recalls the code name'), live.turnsCompleted(run)] },
});
