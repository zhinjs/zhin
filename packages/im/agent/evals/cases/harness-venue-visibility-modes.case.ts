import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.2 / H4: in a multi-bot Venue with `visibility: 'visible'`, the addressed member becomes the
// engagement entry actor and peer collaboration replies are projected into the Venue through each peer's botEndpoint.
export default defineEvalCase({
  id: 'harness-venue-visibility-modes',
  description: 'A visible multi-bot Venue routes to the mentioned member and projects peer collaboration hops via the peer bot endpoint.',
  source: 'ADR 0048 §3.2 / H4 (Venue routing & visible hop projection)',
  tags: ['collaboration'],
  inbound: {
    text: '@architect 评估一下数据库迁移方案并让 coder 给脚本',
    scope: 'group',
    mentions: ['architect'],
    endpointId: 'bot-arch',
    sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } },
  },
  tools: [{ name: 'draft_migration', result: 'ALTER TABLE users ADD COLUMN tenant_id TEXT;' }],
  agents: [
    {
      name: 'architect',
      description: 'Reviews architecture and coordinates with coder.',
      tools: [],
      collaboration: { contacts: ['coder'] },
    },
    {
      name: 'coder',
      description: 'Drafts SQL migration scripts.',
      tools: ['draft_migration'],
    },
  ],
  venue: {
    id: 'dev-room',
    visibility: 'visible',
    entry: 'architect',
    members: [
      { agent: 'architect', botEndpoint: 'bot-arch', aliases: ['架构师'] },
      { agent: 'coder', botEndpoint: 'bot-coder', aliases: ['开发'] },
    ],
  },
  script: [
    {
      actor: 'architect',
      toolCalls: [{ name: 'ask', args: { agent: 'coder', question: 'Write the tenant_id migration SQL.' } }],
    },
    {
      actor: 'coder',
      toolCalls: [{ name: 'draft_migration', args: { column: 'tenant_id' } }],
    },
    {
      actor: 'coder',
      text: '迁移脚本已准备好：ALTER TABLE users ADD COLUMN tenant_id TEXT;',
    },
    {
      actor: 'architect',
      text: '架构评审通过，coder 已给出 tenant_id 迁移脚本。',
    },
  ],
  expect: {
    toolsCalled: ['draft_migration'],
    venueProjections: [
      'bot-arch: @开发 Write the tenant_id migration SQL.',
      'bot-coder: @架构师 迁移脚本已准备好',
    ],
    outboundContains: ['架构评审通过', '[bot-coder] @架构师 迁移脚本已准备好'],
    modelSteps: 4,
  },
});
