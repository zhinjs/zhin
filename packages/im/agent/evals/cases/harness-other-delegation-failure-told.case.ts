import { defineEvalCase } from '../framework/index.js';

// #1250 batch 26 review (B2): two separate jobs for the same agent. The bar chart completes, the pie chart
// runs out of budget. Only a follow-up on the same delegation supersedes a failure; the completed bar
// chart does not, so the human still hears that the pie chart was not made.
export default defineEvalCase({
  id: 'harness-other-delegation-failure-told',
  description: 'A failed delegation is still reported when the same agent completed a different delegation.',
  source: '#1250 batch 26 review (B2)',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '画一张柱状图和一张饼图', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'render_chart', result: 'image: chart.png' }],
  agents: [{ name: 'draw', description: 'Draws charts.', tools: ['render_chart'],
    collaboration: { budget: { modelCalls: 1 } } }],
  script: [
    { toolCalls: [
      { name: 'delegate', args: { agent: 'draw', brief: 'Bar chart of city populations.' } },
      { name: 'delegate', args: { agent: 'draw', brief: 'Pie chart of city populations.' } },
    ] },
    // Bar chart: answered in its one call. Pie chart: spends its one call on a tool call and stops.
    { actor: 'draw', text: '柱状图已经画好。' },
    { actor: 'draw', toolCalls: [{ name: 'render_chart', args: { kind: 'pie' } }] },
    { text: '已经交给 draw 去画了。' },
    { text: '柱状图画好了。' },
    { text: '饼图这次没画成，可以稍后再试。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['已经交给 draw', '柱状图画好了', '饼图这次没画成'],
    outboundMessages: 3,
  },
});
