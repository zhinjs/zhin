import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'deferred-announcement-discover-schema',
  description: 'discover returns the best match with its schema and loads it, so the next model call can use the tool without load_tool.',
  source: 'ADR 0042 §3: discover attaches schemas (was discover -> load_tool -> call -> reply, 4 model calls)',
  tags: ['tool-use'],
  inbound: { text: '发一条群公告：周五放假', scope: 'group', sender: { id: 'owner', roles: ['master'] } },
  tools: [{
    name: 'group_announcement',
    description: 'Publish a group announcement.',
    deferred: true,
    parameters: {
      type: 'object',
      properties: { content: { type: 'string', description: 'ANNOUNCEMENT-SCHEMA-MARKER' } },
      required: ['content'],
    },
    result: 'announced',
  }],
  script: [
    { toolCalls: [{ name: 'discover', args: { query: 'group announcement', kind: 'tool' } }] },
    { toolCalls: [{ name: 'group_announcement', args: { content: '周五放假' } }] },
    { text: '群公告已发布。' },
  ],
  expect: {
    toolsCalled: ['group_announcement'],
    modelInputContains: ['ANNOUNCEMENT-SCHEMA-MARKER'],
    outboundContains: ['群公告已发布'],
    modelSteps: 3,
  },
});
