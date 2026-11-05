import { defineEvalCase } from '../framework/index.js';

const senders = [
  { subjectId: 'alice', displayName: 'Alice', messageIds: ['m1'], texts: ['周会改到几点了？'] },
  { subjectId: 'bob', displayName: 'Bob', messageIds: ['m2'], texts: ['周会在哪个会议室？'] },
];

// ADR 0048 §3.1 / §8 H3: the ADR 0038 group merge window becomes a Mailbox policy that coalesces several
// human Mails into one turn. Two members @ the bot within one window: one model step, one reply that
// @s each sender it answers. Mirrors `merged-turn-mentions-each-sender`, but the merge must come from
// the Mailbox rather than the ingress router.
// Unskip once H3 moves merge-window coalescing into the Mailbox.
export default defineEvalCase({
  id: 'harness-mailbox-merge-window-coalesce',
  description: 'Two human Mails inside one merge window are coalesced by the Mailbox into one turn and one reply that @s both senders.',
  source: 'ADR 0048 §3.1 / §8 H3 (Mailbox absorbs the ADR 0038 merge window)',
  skip: 'ADR 0048 H3',
  tags: ['collaboration'],
  inbound: {
    text: 'Alice: 周会改到几点了？\nBob: 周会在哪个会议室？',
    scope: 'group',
    sender: { id: 'alice', name: 'Alice', roles: ['user'] },
    mergedSenders: senders,
  },
  script: [{ segments: [
    { type: 'mention', data: { target: 'alice' } },
    { type: 'text', data: { text: ' 周会改到下午三点；' } },
    { type: 'mention', data: { target: 'bob' } },
    { type: 'text', data: { text: ' 在 302 会议室。' } },
  ] }],
  expect: {
    modelInputContains: ['[Merged turn] This turn merges 2 senders'],
    outboundContains: ['@alice 周会改到下午三点；@bob 在 302 会议室。'],
    outboundMessages: 1,
    modelSteps: 1,
  },
});
