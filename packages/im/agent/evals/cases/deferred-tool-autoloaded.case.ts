import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'deferred-tool-autoloaded',
  description: 'Calling a catalogued-but-deferred tool directly auto-loads and runs it instead of failing as unknown.',
  source: '#716 core-tools-loaded: direct calls to deferred catalog tools used to fail with "Unknown tool"',
  tags: ['tool-use'],
  inbound: { text: '帮我把明天 9 点的会议加到日历' },
  tools: [{ name: 'calendar_add', description: 'Add an event to the calendar.', deferred: true, result: 'event created' }],
  script: [
    { toolCalls: [{ name: 'calendar_add', args: { title: '会议', at: '09:00' }, notOffered: true }] },
    { text: '已经加到日历：明天 9:00 会议。' },
  ],
  expect: {
    toolsCalled: ['calendar_add'],
    outboundContains: ['已经加到日历'],
    modelSteps: 2,
  },
});
