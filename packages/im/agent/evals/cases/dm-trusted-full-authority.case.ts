import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'dm-trusted-full-authority',
  description: 'A sender on trigger.trusted keeps shell, file write and outbound in a private chat.',
  source: '#753 stranger DMs get group_member — trusted DMs must be unaffected',
  tags: ['approval'],
  inbound: { text: '改端口、跑一下检查，再通知群里', sender: { id: 'alice', roles: ['user', 'trusted'] }, shell: true },
  workspace: { 'config.ts': 'export const port = 3000;\n' },
  nativeTools: ['write_file', 'bash'],
  bashOutput: 'ok',
  tools: [{ name: 'send_group_message', result: 'sent' }],
  script: [
    { toolCalls: [{ name: 'write_file', args: { file_path: 'config.ts', content: 'export const port = 4000;\n' }, notOffered: true }] },
    { toolCalls: [{ name: 'bash', args: { command: 'echo ok' }, notOffered: true }] },
    { toolCalls: [{ name: 'send_group_message', args: { group: 'g1', text: '端口已改为 4000' } }] },
    { text: '已改端口、检查通过并通知群里。' },
  ],
  expect: { toolsCalled: ['write_file', 'bash', 'send_group_message'], outboundContains: ['已改端口'], modelSteps: 4 },
});
