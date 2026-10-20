import { defineEvalCase, live } from '../framework/index.js';

export default defineEvalCase({
  id: 'smoke-structured-reply-mentions-asker',
  description: 'A group member asks the bot to @ them with a confirmation; the structured reply carries a real mention of the sender id and the fact, never raw JSON.',
  source: '#850 smoke suite for the #829 loop: structured replies (#817/#819) in a real group conversation',
  inbound: { text: '@bot 会议改到下午三点了，请 @ 我确认一下', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
  script: [{ segments: [
    { type: 'mention', data: { target: 'bob' } },
    { type: 'text', data: { text: ' 收到：会议改到下午三点。' } },
  ] }],
  expect: {
    outboundContains: ['@bob 收到：会议改到下午三点。'],
    outboundNotContains: ['"segments"', '"mention"'],
    modelSteps: 1,
  },
  live: {
    checks: (run) => [
      live.replyMatches(run, /@bob/u, 'reply mentions the asker by platform id'),
      live.replyMatches(run, /三点|3\s*点|15[:：]00|15\s*点/u, 'reply restates the new meeting time'),
      live.replyNotMatches(run, /"segments"|"mention"/u, 'no raw structured JSON reaches the user'),
      live.turnsCompleted(run),
    ],
  },
});
