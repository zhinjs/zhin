import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-result-double-reply (review): background work (wait: false) fails after the entry agent
// answered. A failure batch offers no no-reply exit: the human must hear once that the work did not finish.
// When the model still declines with the marker, a fixed line goes out instead of silence.
export default defineEvalCase({
  id: 'harness-late-failure-declined-told',
  description: 'A late failure after the answer is told once even when the model declines: a fixed line, never silence.',
  source: '#1250 delegate-result-double-reply',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '画一张城市人口的柱状图', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'render_chart', result: 'image: chart.png' }],
  agents: [{ name: 'draw', description: 'Draws charts.', tools: ['render_chart'], collaboration: { budget: { modelCalls: 1 } } }],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'draw', brief: 'Bar chart of city populations.', wait: false } }] },
    { actor: 'draw', toolCalls: [{ name: 'render_chart', args: { kind: 'bar' } }] },
    { text: '已经交给 draw 去画了。' },
    // The failure wakes the entry model with its earlier reply in view; it declines anyway.
    { text: '[[no_reply]]' },
  ],
  expect: {
    outboundContains: ['已经交给 draw 去画了。', '补充：后台任务没有完成。'],
    outboundNotContains: ['no_reply'],
    outboundMessages: 2,
    // No exit was offered for the failure batch.
    modelInputContains: ['[Already answered]', 'did not finish. Tell the human'],
  },
});
