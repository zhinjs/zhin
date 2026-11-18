import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-result-double-reply: a waited delegation that fails comes back in the tool result. The entry
// model tells the human once; no result mail wakes it for a second account of the same failure.
export default defineEvalCase({
  id: 'harness-delegate-wait-failure-told-once',
  description: 'A delegation that fails while the entry agent waits is told once, in the same turn.',
  source: '#1250 delegate-result-double-reply',
  tags: ['collaboration'],
  inbound: { text: '画一张城市人口的柱状图', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'render_chart', result: 'image: chart.png' }],
  agents: [{ name: 'draw', description: 'Draws charts.', tools: ['render_chart'], collaboration: { budget: { modelCalls: 1 } } }],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'draw', brief: 'Bar chart of city populations.' } }] },
    { actor: 'draw', toolCalls: [{ name: 'render_chart', args: { kind: 'bar' } }] },
    { text: '这次没能画出来，可以稍后再试。' },
    // Trap: a second account of the same failure.
    { text: '绘图任务因预算不足而中止了。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['这次没能画出来'],
    outboundNotContains: ['预算不足', '后台任务'],
    outboundMessages: 1,
    modelInputContains: ['agent draw finished (budget_exceeded'],
    modelSteps: 3,
  },
});
