import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'quoted-message-answered-inline',
  description: 'A reply to an older message carries the quoted text in the message itself (ADR 0043 §4), so the model answers without calling inspect_conversation_reference.',
  source: 'QQ: the bot saw only `reference=ref-1` for a quoted message and either skipped it or spent a tool round trip reading it',
  tags: ['context'],
  inbound: {
    text: '@bot 这个我该选哪个？',
    scope: 'group',
    sender: { id: 'alice', name: 'Alice', roles: ['user'] },
    quote: { id: 'platform-msg-8841', text: '方案A：便宜但要等两周；方案B：贵一倍，明天到', sender: { id: 'bob', name: 'Bob' }, timestamp: Date.UTC(2026, 9, 28, 14, 5) },
  },
  script: [{ text: '赶时间就选 B，不急的话 A 更划算。' }],
  expect: {
    // The quote line is on the message (instance time zone: assert the stable parts only).
    modelInputContains: ['[quote id:platform-msg-8841;user_id:bob;', '方案A：便宜但要等两周'],
    modelInputNotContains: ['Untrusted conversation references', 'reference=ref-1'],
    toolsNotCalled: ['inspect_conversation_reference'],
    outboundContains: ['选 B'],
    modelSteps: 1,
  },
});
