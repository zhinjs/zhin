import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'spin-detected-hint',
  description: 'Three greps in a row that match nothing make the harness tell the model to change approach or answer.',
  source: 'ADR 0042 §7: 21-call kick turn spent grepping plugin source in a group',
  tags: ['long-task', 'context'],
  inbound: { text: '怎么踢人？', sender: { id: 'master', roles: ['master'] } },
  workspace: { 'a.ts': 'export const a = 1;\n' },
  nativeTools: ['grep'],
  script: [
    { toolCalls: [{ name: 'grep', args: { pattern: 'kick_member' } }] },
    { toolCalls: [{ name: 'grep', args: { pattern: 'ban_user' } }] },
    { toolCalls: [{ name: 'grep', args: { pattern: 'remove_member' } }] },
    { text: '源码里没找到踢人工具，我先按现有信息回答：需要群管插件。' },
  ],
  expect: {
    toolsCalled: ['grep'],
    modelInputContains: ['[Harness note] 3 search calls in a row returned nothing new'],
    requestInputContains: { 4: ['Change your approach'] },
    modelSteps: 4,
  },
});
