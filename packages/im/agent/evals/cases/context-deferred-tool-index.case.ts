import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'context-deferred-tool-index',
  description: 'Deferred tools are folded into one line per domain (names and count) without their schema; load_tool brings the schema in.',
  source: '#729 M2.2: deferred tools were invisible to the model unless it guessed a discover query',
  tags: ['context', 'tool-use'],
  inbound: { text: '帮我把明天 9 点的会议加到日历' },
  tools: [
    {
      name: 'calendar_add',
      description: 'Add an event to the calendar. Long parameter guidance follows and must not be resident.',
      deferred: true,
      result: 'event created',
    },
  ],
  script: [
    { toolCalls: [{ name: 'load_tool', args: { name: 'calendar_add' } }] },
    { toolCalls: [{ name: 'calendar_add', args: { title: '会议', at: '09:00' } }] },
    { text: '已经加到日历：明天 9:00 会议。' },
  ],
  expect: {
    toolsCalled: ['calendar_add'],
    modelInputContains: ['## Deferred tools', 'calendar_add (1)', 'Loaded tool "calendar_add"'],
    modelInputNotContains: ['Long parameter guidance'],
    outboundContains: ['已经加到日历'],
    modelSteps: 3,
  },
});
