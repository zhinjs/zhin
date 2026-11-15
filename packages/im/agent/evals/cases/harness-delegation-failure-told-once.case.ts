import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-failure-message-flood: two delegations to the same agent both run out of budget and nothing
// supersedes them. The entry agent explains the first failure; the second does not wake it again (no second
// model-written account), the human gets one deterministic line counting it instead.
export default defineEvalCase({
  id: 'harness-delegation-failure-told-once',
  description: 'Two failed delegations of one request: one model-written account, then one fixed line for the other.',
  source: '#1250 delegate-failure-message-flood',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '画两张城市人口的图', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'render_chart', result: 'image: chart.png' }],
  agents: [{ name: 'draw', description: 'Draws charts.', tools: ['render_chart'],
    collaboration: { budget: { modelCalls: 1 } } }],
  script: [
    { toolCalls: [
      { name: 'delegate', args: { agent: 'draw', brief: 'Bar chart of city populations.' } },
      { name: 'delegate', args: { agent: 'draw', brief: 'Pie chart of city populations.' } },
    ] },
    { actor: 'draw', toolCalls: [{ name: 'render_chart', args: { kind: 'bar' } }] },
    { actor: 'draw', toolCalls: [{ name: 'render_chart', args: { kind: 'pie' } }] },
    { text: '已经交给 draw 去画了。' },
    { text: '这次绘图没能完成，可以稍后再试。' },
    // Trap: a second account of the same request's failure.
    { text: '饼图也因预算不足而中止了。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['已经交给 draw', '这次绘图没能完成', '另有 1 项后台任务没有完成。'],
    outboundNotContains: ['预算不足'],
    outboundMessages: 3,
    // entry: delegate, ack, first account; draw: one call per sub-turn. The trap is never requested.
    modelSteps: 5,
  },
});
