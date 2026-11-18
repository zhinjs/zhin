import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-result-double-reply (review): a failure the entry model read in a waiting delegate and answered
// from counts as told. A second failure of the same request then gets the one fixed counting line instead of
// waking the entry model for another account.
export default defineEvalCase({
  id: 'harness-wait-failure-counts-as-told',
  description: 'A failure read in a waiting delegate counts as told: a further failure gets one fixed line.',
  source: '#1250 delegate-result-double-reply',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '画两张城市人口的图', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'render_chart', result: 'image: chart.png' }],
  agents: [{ name: 'draw', description: 'Draws charts.', tools: ['render_chart'], collaboration: { budget: { modelCalls: 1 } } }],
  script: [
    { toolCalls: [
      { name: 'delegate', args: { agent: 'draw', brief: 'Bar chart of city populations.' } },
      { name: 'delegate', args: { agent: 'draw', brief: 'Pie chart of city populations.', wait: false } },
    ] },
    { actor: 'draw', toolCalls: [{ name: 'render_chart', args: { kind: 'bar' } }] },
    { actor: 'draw', toolCalls: [{ name: 'render_chart', args: { kind: 'pie' } }] },
    { text: '柱状图这次没能画出来，可以稍后再试。' },
    // Trap: a second model-written account of the same request's failure.
    { text: '饼图也因预算不足而中止了。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['柱状图这次没能画出来', '另有 1 项后台任务没有完成。'],
    outboundNotContains: ['预算不足'],
    outboundMessages: 2,
    modelInputContains: ['agent draw finished (budget_exceeded'],
    // entry: delegates, answer; draw: one call per sub-turn. The trap is never requested.
    modelSteps: 4,
  },
});
