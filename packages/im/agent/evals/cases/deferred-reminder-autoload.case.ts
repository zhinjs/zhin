import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'deferred-reminder-autoload',
  description: 'A reminder request in a group completes in two model calls by calling the deferred tool by name.',
  source: 'ADR 0042 §3: discover-and-call (was discover -> load_tool -> call -> reply, 4 model calls)',
  tags: ['tool-use'],
  inbound: { text: '明天 9 点提醒我开会', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
  tools: [{ name: 'set_reminder', description: 'Set a reminder at a given time.', deferred: true, result: 'reminder set' }],
  script: [
    { toolCalls: [{ name: 'set_reminder', args: { at: '09:00', text: '开会' }, notOffered: true }] },
    { text: '好的，明天 9 点提醒你开会。' },
  ],
  expect: { toolsCalled: ['set_reminder'], outboundContains: ['提醒你开会'], modelSteps: 2 },
});
