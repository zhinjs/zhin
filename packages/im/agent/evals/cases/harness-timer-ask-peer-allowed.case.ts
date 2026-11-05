import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.3 / §8 H3: a turn started by a timer Mail is an ordinary Actor turn, so it may use the H2
// collaboration tools. Here the timer-driven turn `ask`s a peer within its contacts and reports the answer.
// HOOK GAP: needs timer Mail inbound fixture for unskip. Until then the inbound below is an ordinary
// human message standing in for the timer Mail payload.
export default defineEvalCase({
  id: 'harness-timer-ask-peer-allowed',
  description: 'A timer-started turn may ask a peer in its contacts and relays the peer answer to the human.',
  source: 'ADR 0048 §3.1 / §3.3 / §8 H3 (timer Mail turns use the collaboration tools)',
  skip: 'ADR 0048 H3',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '[timer] 每日例行：汇总今天的构建状态', sender: { id: 'master', roles: ['master'] } },
  tools: [{ name: 'lookup_ci', result: 'main: green' }],
  agents: [{ name: 'ops', description: 'Reads CI status; read-only.', tools: ['lookup_ci'] }],
  script: [
    { toolCalls: [{ name: 'ask', args: { agent: 'ops', question: 'What is the CI status of main today?' } }] },
    { actor: 'ops', toolCalls: [{ name: 'lookup_ci', args: { branch: 'main' } }] },
    { actor: 'ops', text: 'main is green.' },
    { text: '今日构建汇总：main 分支全部通过。' },
  ],
  expect: {
    toolsCalled: ['ask'],
    outboundContains: ['main 分支全部通过'],
  },
});
