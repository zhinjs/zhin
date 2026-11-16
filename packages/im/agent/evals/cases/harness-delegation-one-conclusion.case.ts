import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-failure-message-flood: one request, the entry agent delegates to `draw` twice (both sub-turns
// run out of budget), follows up once (completed) and then trips the pair round-trip guard. The human gets one
// conclusion: the entry agent's answer. Never the guard's developer text (`Actors … above the limit`), never
// "需要你来决定" without a way to decide, and no separate budget-stop messages for the stale delegations.
export default defineEvalCase({
  id: 'harness-delegation-one-conclusion',
  description: 'Guard stops and stale budget stops of sub-agents stay in the trace; the request gets one reply.',
  source: '#1250 delegate-failure-message-flood',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '把北京、上海、广州的人口做成一张表格图片发给我', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'render_table', result: 'image: table.png' }],
  agents: [{ name: 'draw', description: 'Draws charts and tables.', tools: ['render_table'],
    collaboration: { budget: { modelCalls: 1 } } }],
  // Steps are consumed per actor, in order. draw: each delegated sub-turn spends its one call on a tool call
  // and stops; the follow-up answers in one call.
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'draw', brief: 'Draw a population table image.' } }] },
    { actor: 'draw', toolCalls: [{ name: 'render_table', args: { cities: ['北京', '上海', '广州'] } }] },
    { toolCalls: [{ name: 'delegate', args: { agent: 'draw', brief: 'Draw the table again, smaller.' } }] },
    { actor: 'draw', toolCalls: [{ name: 'render_table', args: { cities: ['北京', '上海', '广州'], size: 'small' } }] },
    { toolCalls: [{ name: 'follow_up', args: { mail_id: 'm-eval-3', content: 'Is the table image ready?' } }] },
    { actor: 'draw', text: '表格图片已经生成。' },
    // Exchange #4 between zhin and draw: denied, and the engagement is stopped.
    { toolCalls: [{ name: 'follow_up', args: { mail_id: 'm-eval-4', content: 'Make one more version.' } }] },
    { text: '表格图片做好了：北京 2185 万、上海 2487 万、广州 1882 万。' },
    // Traps: stale budget stops must not wake the entry agent again.
    { text: 'draw 这次超出可用预算，没能完成任务。' },
    { text: '绘图任务因预算不足而中止，没有生成结果。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['表格图片做好了'],
    outboundNotContains: ['Actors', 'above the limit', '协作已暂停', '需要你来决定', '预算'],
    outboundMessages: 1,
    modelInputContains: ['Collaboration for this request has stopped'],
    modelSteps: 8,
  },
});
