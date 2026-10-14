import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'group-master-unaffected',
  description: 'The master in a group keeps the same tools: messaging another conversation still works.',
  source: '#719 group_member turn tightening — master must not be affected (PR #737)',
  tags: ['approval'],
  inbound: { text: '@bot 私聊提醒 alice 明天开会', scope: 'group', sender: { id: 'master', roles: ['master'] } },
  tools: [{ name: 'send_private_message', result: 'sent' }],
  script: [
    { toolCalls: [{ name: 'send_private_message', args: { to: 'alice', text: '明天开会' } }] },
    { text: '已私聊提醒 alice。' },
  ],
  expect: { toolsCalled: ['send_private_message'], outboundContains: ['已私聊提醒'], modelSteps: 2 },
});
