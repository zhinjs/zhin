import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'provider-malformed-tool-call',
  description: 'A tool call with arguments that fail the schema does not run the tool; the model sees the error and recovers.',
  source: '#724 provider resilience (malformed tool call)',
  tags: ['tool-use'],
  inbound: { text: '看看 notes.md 里写了什么' },
  workspace: { 'notes.md': '周五发布 1.2 版本' },
  nativeTools: ['read_file'],
  script: [
    { toolCalls: [{ name: 'read_file', args: { file_path: 42, bogus: true }, notOffered: true }] },
    { toolCalls: [{ name: 'read_file', args: { path: 'notes.md' } }] },
    { text: 'notes.md 里写着：周五发布 1.2 版本。' },
  ],
  expect: {
    modelInputContains: ['Invalid arguments for tool read_file'],
    outboundContains: ['周五发布 1.2 版本'],
    termination: 'turn_end',
    modelSteps: 3,
  },
});
