import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §3.3 / H2: collaborating agents share an engagement blackboard (`board_write` / `board_read`)
// and can send `follow_up` instructions on a previous `ask` / `delegate` (`mail_id`).
export default defineEvalCase({
  id: 'harness-board-and-follow-up',
  description: 'Collaborating agents exchange artifacts via board_write/board_read and send follow_up on prior work.',
  source: 'ADR 0048 §3.3 (board_write, board_read, follow_up)',
  tags: ['collaboration', 'long-task'],
  inbound: { text: '把目标环境记到黑板，让 researcher 读黑板后再追问对应区域代码', sender: { id: 'master', chatRole: 'owner' } },
  tools: [{ name: 'lookup_docs', result: 'staging region: ap-east-1' }],
  agents: [
    {
      name: 'researcher',
      description: 'Reads the board and looks up environment docs.',
      tools: ['lookup_docs'],
      collaboration: { contacts: ['zhin'] },
    },
  ],
  script: [
    {
      toolCalls: [
        { name: 'board_write', args: { kind: 'note', key: 'target-env', summary: 'Target environment', content: 'env=staging' } },
        { name: 'ask', args: { agent: 'researcher', question: 'Read target-env from the board.' } },
      ],
    },
    {
      actor: 'researcher',
      toolCalls: [{ name: 'board_read', args: { key: 'target-env' } }],
    },
    {
      actor: 'researcher',
      text: 'Board says env=staging.',
    },
    {
      toolCalls: [
        { name: 'follow_up', args: { mail_id: 'm3', content: 'Now look up the region code for staging.' } },
      ],
    },
    {
      actor: 'researcher',
      toolCalls: [{ name: 'lookup_docs', args: { env: 'staging' } }],
    },
    {
      actor: 'researcher',
      text: 'The staging region code is ap-east-1.',
    },
    {
      text: 'researcher 已读取黑板并完成核查：staging 环境区域为 ap-east-1。',
    },
  ],
  expect: {
    toolsCalled: ['board_write', 'ask', 'board_read', 'follow_up', 'lookup_docs'],
    modelInputContains: ['env=staging', '[Follow-up on m3]'],
    outboundContains: ['ap-east-1'],
    modelSteps: 7,
  },
});
