import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.1 / §8 H3: scheduled work becomes `timer` Mail (replacing the `assistant/` job engine).
// A due timer Mail delivered to an Actor's Mailbox opens an Engagement and runs one turn whose result
// reaches the human who set the reminder.
// HOOK GAP: needs timer Mail inbound fixture for unskip. Until then the inbound below is an ordinary
// human message standing in for the timer Mail payload.
export default defineEvalCase({
  id: 'harness-timer-mail-starts-engagement',
  description: 'A due timer Mail opens an Engagement and the turn it starts delivers the reminder to the human.',
  source: 'ADR 0048 §3.1 / §8 H3 (timer Mail replaces the assistant job engine)',
  skip: 'ADR 0048 H3',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '[timer] 提醒：下午三点开周会', sender: { id: 'master', roles: ['master'] } },
  script: [{ text: '提醒你：下午三点开周会。' }],
  expect: {
    modelSteps: 1,
    outboundMessages: 1,
    outboundContains: ['下午三点开周会'],
  },
});
