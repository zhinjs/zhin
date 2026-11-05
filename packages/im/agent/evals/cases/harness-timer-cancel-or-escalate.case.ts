import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.3 / §8 H3: a timer-started turn that cannot finish its job alone must end cleanly: it
// either cancels its own delegation or escalates to the human, never loops or stays silent.
// HOOK GAP: Gap A inbound shape is ready (`kind: 'timer'`); keep skipped until clever PR-3 wires
// `deliverTimerMailInbound` (timer Mail entry). Do not unskip here.
export default defineEvalCase({
  id: 'harness-timer-cancel-or-escalate',
  description: 'A timer-started turn that cannot complete escalates to the human once instead of looping.',
  source: 'ADR 0048 §3.3 / §8 H3 (timer Mail turns end via cancel or escalate)',
  skip: 'ADR 0048 H3',
  tags: ['collaboration', 'long-task'],
  inbound: {
    kind: 'timer',
    timerId: 'daily-cert-renew',
    content: '每日例行：续订即将过期的证书',
    owner: { id: 'master', roles: ['master'] },
  },
  script: [
    { toolCalls: [{ name: 'escalate', args: { reason: 'Renewing the certificate needs an owner decision.' } }] },
    { text: '证书续订需要你确认，我先停在这里等你决定。' },
  ],
  allowUnusedSteps: true,
  expect: {
    toolsCalled: ['escalate'],
    outboundContains: ['需要你确认'],
  },
});
