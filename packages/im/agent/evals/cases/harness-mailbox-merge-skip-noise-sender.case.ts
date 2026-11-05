import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.1 / §8 H3: within a Mailbox-coalesced turn, a sender whose Mail is noise is not answered
// and is not @-ed. Mirrors `merged-turn-skipped-sender-not-mentioned`, but the merge must come from the
// Mailbox policy rather than the ingress router.
// Unskip once H3 moves merge-window coalescing into the Mailbox.
export default defineEvalCase({
  id: 'harness-mailbox-merge-skip-noise-sender',
  description: 'A Mailbox-coalesced turn answers the real question and does not @ the sender whose Mail is noise.',
  source: 'ADR 0048 §3.1 / §8 H3 (Mailbox merge policy; skipped senders are not pretended to)',
  skip: 'ADR 0048 H3',
  tags: ['collaboration'],
  inbound: {
    text: 'Alice: 报名截止到哪天？\nBob: 哈哈哈',
    scope: 'group',
    sender: { id: 'alice', name: 'Alice', roles: ['user'] },
    mergedSenders: [
      { subjectId: 'alice', displayName: 'Alice', texts: ['报名截止到哪天？'] },
      { subjectId: 'bob', displayName: 'Bob', texts: ['哈哈哈'] },
    ],
  },
  script: [{ segments: [
    { type: 'mention', data: { target: 'alice' } },
    { type: 'text', data: { text: ' 报名截止到本周日。' } },
  ] }],
  expect: {
    modelInputContains: ['[Merged turn] This turn merges 2 senders'],
    outboundContains: ['@alice 报名截止到本周日。'],
    outboundNotContains: ['@bob'],
    modelSteps: 1,
  },
});
