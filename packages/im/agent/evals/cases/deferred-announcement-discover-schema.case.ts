import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'deferred-announcement-discover-schema',
  description: 'discover loads the best match without echoing its schema into history; the next request can call it without load_tool.',
  source: '#1102: deduplicate discover results while preserving ADR 0042 discover -> call -> reply (3 model calls)',
  tags: ['tool-use'],
  workspace: {},
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
    modelInputNotContains: ['ANNOUNCEMENT-SCHEMA-MARKER'],
    outboundContains: ['群公告已发布'],
    modelSteps: 3,
  },
});
