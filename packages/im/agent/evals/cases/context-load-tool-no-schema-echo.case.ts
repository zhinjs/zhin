import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'context-load-tool-no-schema-echo',
  description: 'A deferred tool becomes callable without echoing its schema into history.',
  source: '#954: load_tool duplicated the authoritative request schema',
  tags: ['context', 'tool-use'],
  tools: [{ name: 'lookup', description: 'Look up an item', deferred: true, parameters: {
    type: 'object', properties: { query: { type: 'string', description: 'UNIQUE-PARAMETER-SCHEMA' } }, required: ['query'],
  }, result: 'found' }],
  inbound: [{ text: '查一下' }, { text: '继续' }],
  script: [
    { toolCalls: [{ name: 'load_tool', args: { name: 'lookup' } }] },
    { toolCalls: [{ name: 'lookup', args: { query: 'test' } }] },
    { text: '找到啦' }, { text: '收到' },
  ],
  expect: { modelSteps: 4, stableSystemPrompt: true, toolsCalled: ['lookup'], modelInputNotContains: ['Parameters schema:', 'UNIQUE-PARAMETER-SCHEMA'] },
});
