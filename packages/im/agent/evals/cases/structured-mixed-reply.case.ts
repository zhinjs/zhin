import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'structured-mixed-reply',
  description: 'Default IM reply preserves ordered Markdown, member mention and image segments after a lookup.',
  source: 'Agent structured reply contract — rich messages through the full runtime',
  inbound: { text: '请把图和说明发出来，并 @ Alice', sender: { id: 'owner', roles: ['user'] } },
  tools: [{ name: 'lookup_member', description: 'Find Alice in the current conversation.', result: { id: '123', name: 'Alice' } }],
  script: [
    { toolCalls: [{ name: 'lookup_member', args: {} }] },
    { segments: [
      { type: 'markdown', data: { content: '**处理结果**\n' } },
      { type: 'mention', data: { target: '123' } },
      { type: 'text', data: { text: '，请查收：' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/result.png' } } },
    ] },
  ],
  expect: {
    outboundContains: ['**处理结果**\n@123，请查收：[image]'],
    outboundNotContains: ['"segments"'],
    modelSteps: 2,
  },
});
