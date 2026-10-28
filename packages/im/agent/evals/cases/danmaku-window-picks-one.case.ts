import { defineEvalCase, live } from '../framework/index.js';

const senders = [
  { subjectId: 'v1', displayName: '路人甲', texts: ['主播今天播什么游戏？'] },
  { subjectId: 'v2', displayName: '弹幕侠', texts: ['666', '666'] },
  { subjectId: 'v3', texts: ['第一次来，关注了'] },
];

export default defineEvalCase({
  id: 'danmaku-window-picks-one',
  description: 'A live room danmaku window: the model sees the [Danmaku window] list and replies once, @-ing only the one viewer it picked.',
  source: '#1049 ADR 0038 §5 slice E: danmaku mode, pick-one',
  inbound: {
    text: '路人甲: 主播今天播什么游戏？\n弹幕侠: 666\n666\nv3: 第一次来，关注了',
    scope: 'group',
    sender: { id: 'v1', name: '路人甲', roles: ['user'] },
    liveDanmaku: { mode: 'pick-one', candidates: 30, senders },
  },
  script: [{ segments: [
    { type: 'mention', data: { target: 'v1' } },
    { type: 'text', data: { text: ' 今天播星露谷～' } },
  ] }],
  expect: {
    modelInputContains: [
      '[Danmaku window] Live-stream danmaku since your last reply: 30 received, 3 viewers listed',
      '- id="v2" name="弹幕侠": 666 / 666',
      'Pick the one danmaku most worth answering',
    ],
    outboundContains: ['@v1 今天播星露谷～'],
    outboundMessages: 1,
    modelSteps: 1,
  },
  live: {
    checks: (run) => [
      live.replyNotMatches(run, /@v1[\s\S]*@v2|@v2[\s\S]*@v1/u, 'reply @s at most one viewer'),
      live.replyNotMatches(run, /"segments"|"mention"/u, 'no raw structured JSON reaches the user'),
      live.turnsCompleted(run),
    ],
  },
});
