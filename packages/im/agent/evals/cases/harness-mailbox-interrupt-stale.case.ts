import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.1 / §8 H3: interruption and the stale-turn check become Mailbox policies ("who may
// interrupt"). When the same human sends a correcting Mail while the first turn is still running, the
// stale answer to the superseded Mail must not reach the user; only the corrected request is answered.
// HOOK GAP: the framework runs consecutive inbound as sequential turns; unskip needs a fixture that
// delivers the second Mail while the first turn is in flight (mid-turn Mail arrival).
export default defineEvalCase({
  id: 'harness-mailbox-interrupt-stale',
  description: 'A correcting Mail from the same human interrupts the running turn; the stale answer is never sent.',
  source: 'ADR 0048 §3.1 / §8 H3 (Mailbox absorbs interrupt and stale checks)',
  skip: 'ADR 0048 H3',
  tags: ['collaboration', 'long-task'],
  inbound: [
    { text: '帮我订明天上午的会议室', sender: { id: 'master', roles: ['master'] } },
    { text: '不对，改成明天下午', sender: { id: 'master', roles: ['master'] } },
  ],
  script: [
    { text: '好的，已为你记下明天上午的会议室。' },
    { text: '好的，已改为明天下午的会议室。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['明天下午'],
    outboundNotContains: ['明天上午的会议室'],
    outboundMessages: 1,
  },
});
