import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.4 invariant 2 / §8 H3: a timer Mail carries its own budget grant. A timer-started turn
// that keeps calling tools is stopped when the grant runs out and still reports back cleanly instead of
// running unbounded in the background.
export default defineEvalCase({
  id: 'harness-timer-budget-enforced',
  description: 'A timer-started turn is stopped by its budget grant and still reports what it finished.',
  source: 'ADR 0048 §3.4 invariant 2 / §8 H3 (timer Mail is funded from a bounded budget)',
  tags: ['collaboration', 'long-task', 'quota'],
  inbound: {
    kind: 'timer',
    timerId: 'hourly-health-check',
    content: '每小时巡检：检查所有服务的健康状态',
    owner: { id: 'master', roles: ['master'] },
    // Bounded grant: two model calls for tool work, then report-back (trap steps unused).
    budget: { modelCalls: 2 },
  },
  tools: [{ name: 'check_service', result: 'healthy' }],
  // The trailing tool calls are traps: the budget must stop the turn before they are requested.
  script: [
    { toolCalls: [{ name: 'check_service', args: { service: 'api' } }] },
    { toolCalls: [{ name: 'check_service', args: { service: 'web' } }] },
    { toolCalls: [{ name: 'check_service', args: { service: 'worker' } }] },
    { text: '巡检预算用完了，已检查 api，其余服务下次继续。' },
  ],
  allowUnusedSteps: true,
  expect: {
    maxModelSteps: 3,
    outboundContains: ['预算用完了'],
  },
});
