import { defineEvalCase, live } from '../framework/index.js';

export default defineEvalCase({
  id: 'merged-turn-skipped-sender-not-mentioned',
  description: 'A merged turn where one message is noise: the reply answers the real question and does not @ the sender it skips.',
  source: '#1049 ADR 0038 §3 slice C: senders the reply does not answer are not pretended to',
  inbound: {
    text: 'Alice: 明天几点集合？\nBob: 哈哈哈',
    scope: 'group',
    sender: { id: 'alice', name: 'Alice', roles: ['user'] },
    mergedSenders: [
      { subjectId: 'alice', displayName: 'Alice', texts: ['明天几点集合？'] },
      { subjectId: 'bob', displayName: 'Bob', texts: ['哈哈哈'] },
    ],
  },
  script: [{ segments: [
    { type: 'mention', data: { target: 'alice' } },
    { type: 'text', data: { text: ' 明早九点在门口集合。' } },
  ] }],
  expect: {
    modelInputContains: ['[Merged turn] This turn merges 2 senders'],
    outboundContains: ['@alice 明早九点在门口集合。'],
    outboundNotContains: ['@bob'],
    modelSteps: 1,
  },
  live: {
    checks: (run) => [
      live.replyMatches(run, /@alice/u, 'reply @s the sender it answers'),
      live.replyMatches(run, /九点|9\s*点|09[:：]00/u, 'reply keeps the answer'),
      live.turnsCompleted(run),
    ],
  },
});
