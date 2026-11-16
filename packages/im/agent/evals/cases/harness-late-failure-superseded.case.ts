import { defineEvalCase } from '../framework/index.js';

// #1250 delegate-late-failure-message-contradicts: the entry agent delegates, then follows up on the same
// delegation. The first sub-turn runs out of budget, the follow-up completes and the entry agent answers with
// it. The earlier budget stop arrives as a result mail after that answer: it stays in the trace and must not
// wake the entry agent to send "规划代理因预算不足而停止" after the correct answer.
export default defineEvalCase({
  id: 'harness-late-failure-superseded',
  description: 'A delegated sub-turn that ran out of budget is not reported once a follow-up on the same delegation completed.',
  source: '#1250 delegate-late-failure-message-contradicts',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '让 planner 排一下明天的行程', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  tools: [{ name: 'lookup_calendar', result: '明天 9:00 例会，14:00 评审' }],
  agents: [{ name: 'planner', description: 'Plans schedules.', tools: ['lookup_calendar'],
    collaboration: { budget: { modelCalls: 1 } } }],
  script: [
    { toolCalls: [{ name: 'delegate', args: { agent: 'planner', brief: 'Plan tomorrow.' } }] },
    // planner's first sub-turn spends its one model call on a tool call; it stops before a second request.
    { actor: 'planner', toolCalls: [{ name: 'lookup_calendar', args: { day: 'tomorrow' } }] },
    { toolCalls: [{ name: 'follow_up', args: { mail_id: 'm-eval-3', content: 'Just list tomorrow\'s meetings.' } }] },
    { actor: 'planner', text: '明天 9:00 例会，14:00 评审。' },
    { text: '明天的安排：9:00 例会，14:00 评审。' },
    // Trap: the stale budget stop must not wake the entry agent again.
    { text: '规划代理因预算不足而停止，未能完成任务。' },
  ],
  allowUnusedSteps: true,
  expect: {
    outboundContains: ['9:00 例会'],
    outboundNotContains: ['预算不足', '预算用完'],
    outboundMessages: 1,
    // entry: delegate, follow_up, answer; planner: one call per sub-turn. The trap is never requested.
    modelSteps: 5,
  },
});
