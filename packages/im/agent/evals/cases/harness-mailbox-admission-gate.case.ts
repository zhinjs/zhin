import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.1 / §8 H3: turn admission (today's `TurnAdmissionGate`) becomes a Mailbox policy.
// A human Mail that the policy does not admit (an ordinary group message that neither @s the bot nor
// replies to it) must never start a turn: no model request, no outbound.
// Unskip once H3 routes IM inbound through the Mailbox admission policy.
export default defineEvalCase({
  id: 'harness-mailbox-admission-gate',
  description: 'A group message the Mailbox admission policy rejects starts no turn: zero model steps and no reply.',
  source: 'ADR 0048 §3.1 / §8 H3 (Mailbox absorbs turn admission)',
  skip: 'ADR 0048 H3',
  tags: ['collaboration'],
  inbound: {
    text: '今天食堂有什么菜？',
    scope: 'group',
    sender: { id: 'member-1', name: 'Member', roles: ['user'] },
  },
  // Trap step: an admitted turn would consume it. The admission policy must reject the Mail first.
  script: [{ text: '今天食堂有红烧肉。' }],
  allowUnusedSteps: true,
  expect: {
    modelSteps: 0,
    outboundMessages: 0,
  },
});
