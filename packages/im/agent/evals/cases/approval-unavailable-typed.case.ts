import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'approval-unavailable-typed',
  description: 'With no approval channel the gated tool is denied with an explicit "unavailable" reason, not a fake user denial.',
  source: '#716 typed approval outcomes (no channel ≠ user said no)',
  tags: ['approval'],
  inbound: { text: '重启一下机器人', sender: { id: 'owner', roles: ['master'] } },
  tools: [{ name: 'restart_bot', requiresApproval: 'once', result: 'restarting' }],
  approval: 'unavailable',
  script: [
    { toolCalls: [{ name: 'restart_bot' }] },
    { text: '这里没法发起审批，所以没有重启；请在私聊或控制台里操作。' },
  ],
  expect: {
    toolsNotCalled: ['restart_bot'],
    modelInputContains: ['unavailable'],
    outboundContains: ['没有重启'],
    modelSteps: 2,
  },
});
