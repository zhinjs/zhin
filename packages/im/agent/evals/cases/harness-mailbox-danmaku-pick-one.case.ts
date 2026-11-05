import { defineEvalCase } from '../framework/index.js';

const senders = [
  { subjectId: 'v1', displayName: '路人甲', texts: ['主播下一把玩什么英雄？'] },
  { subjectId: 'v2', displayName: '弹幕侠', texts: ['666', '666'] },
  { subjectId: 'v3', texts: ['来了来了'] },
];

// ADR 0048 §3.1 / §8 H3: the live-stream danmaku window (today's `live` mode) becomes a Mailbox policy.
// The Mailbox batches danmaku Mail since the last reply into one turn; the reply answers exactly one
// viewer. Mirrors `danmaku-window-picks-one`, but the window must come from the Mailbox.
// Unskip once H3 moves the danmaku window into the Mailbox.
export default defineEvalCase({
  id: 'harness-mailbox-danmaku-pick-one',
  description: 'A Mailbox danmaku window becomes one turn and one reply that @s only the single viewer it picked.',
  source: 'ADR 0048 §3.1 / §8 H3 (Mailbox absorbs the ADR 0038 danmaku window)',
  skip: 'ADR 0048 H3',
  tags: ['collaboration'],
  inbound: {
    text: '路人甲: 主播下一把玩什么英雄？\n弹幕侠: 666\n666\nv3: 来了来了',
    scope: 'group',
    sender: { id: 'v1', name: '路人甲', roles: ['user'] },
    liveDanmaku: { mode: 'pick-one', candidates: 12, senders },
  },
  script: [{ segments: [
    { type: 'mention', data: { target: 'v1' } },
    { type: 'text', data: { text: ' 下一把玩辅助～' } },
  ] }],
  expect: {
    modelInputContains: ['[Danmaku window]', 'Pick the one danmaku most worth answering'],
    outboundContains: ['@v1 下一把玩辅助～'],
    outboundNotContains: ['@v2', '@v3'],
    outboundMessages: 1,
    modelSteps: 1,
  },
});
