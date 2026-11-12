import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.4 invariant 7: bot messages in a Venue (`origin: 'member' | 'peer_bot' | 'self'`)
// are never admitted as `human` Mail turns; agent-to-agent work flows only through the Mailbox.
export default defineEvalCase({
  id: 'harness-venue-bot-origin-not-human',
  description: 'Bot-origin messages in a Venue (member / peer_bot / self) never start a human Mail turn.',
  source: 'ADR 0048 §3.4 invariant 7 (bot messages in a Venue are not human Mail)',
  tags: ['collaboration', 'injection'],
  inbound: [
    {
      text: '@architect 我刚刚在群里发了一条同步消息',
      scope: 'group',
      origin: 'member',
      mentions: ['architect'],
      endpointId: 'bot-arch',
      sender: { id: 'bot-coder' },
    },
    {
      text: '@architect 外部机器人广播',
      scope: 'group',
      origin: 'peer_bot',
      mentions: ['architect'],
      endpointId: 'bot-arch',
      sender: { id: 'external-bot' },
    },
  ],
  agents: [
    { name: 'architect', description: 'Architecture lead.', tools: [] },
    { name: 'coder', description: 'Implementation engineer.', tools: [] },
  ],
  venue: {
    id: 'dev-room',
    visibility: 'visible',
    entry: 'architect',
    members: [
      { agent: 'architect', botEndpoint: 'bot-arch' },
      { agent: 'coder', botEndpoint: 'bot-coder' },
    ],
  },
  allowUnusedSteps: true,
  script: [
    { actor: 'architect', text: 'must never run' },
  ],
  expect: {
    termination: 'none',
    modelSteps: 0,
    outboundMessages: 0,
    venueProjections: [],
  },
});
