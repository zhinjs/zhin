import { defineEvalCase, live } from '../framework/index.js';

const senders = [
  { subjectId: 'alice', displayName: 'Alice', messageIds: ['m1'], texts: ['今晚几点开会？'] },
  { subjectId: 'bob', displayName: 'Bob', messageIds: ['m2'], texts: ['会议链接在哪？'] },
  { subjectId: 'carol', displayName: 'Carol', messageIds: ['m3'], texts: ['我能旁听吗？'] },
];

export default defineEvalCase({
  id: 'merged-turn-mentions-each-sender',
  description: 'Three members @ the bot within one merge window: the model sees the [Merged turn] list and replies once, @-ing each sender it answers.',
  source: '#1049 ADR 0038 §3 slice C: merged turn context and per-sender @ replies',
  inbound: {
    text: 'Alice: 今晚几点开会？\nBob: 会议链接在哪？\nCarol: 我能旁听吗？',
    scope: 'group',
    sender: { id: 'alice', name: 'Alice', roles: ['user'] },
    mergedSenders: senders,
  },
  script: [{ segments: [
    { type: 'mention', data: { target: 'alice' } },
    { type: 'text', data: { text: ' 今晚八点开会；' } },
    { type: 'mention', data: { target: 'bob' } },
    { type: 'text', data: { text: ' 链接在群公告；' } },
    { type: 'mention', data: { target: 'carol' } },
    { type: 'text', data: { text: ' 可以旁听。' } },
  ] }],
  expect: {
    modelInputContains: [
      '[Merged turn] This turn merges 3 senders',
      '- id="bob" name="Bob" messages=["m2"]: 会议链接在哪？',
      'Do not mention or pretend to answer a sender you skip',
    ],
    outboundContains: ['@alice 今晚八点开会；@bob 链接在群公告；@carol 可以旁听。'],
    outboundMessages: 1,
    modelSteps: 1,
  },
  live: {
    checks: (run) => [
      live.replyMatches(run, /@alice/u, 'reply @s the first sender'),
      live.replyMatches(run, /@bob/u, 'reply @s the second sender'),
      live.replyMatches(run, /@carol/u, 'reply @s the third sender'),
      live.replyNotMatches(run, /"segments"|"mention"/u, 'no raw structured JSON reaches the user'),
      live.turnsCompleted(run),
    ],
  },
});
