import { defineEvalCase } from '../framework/index.js';

// ADR 0048 §2 / H4: addressing `@<specialist>` routes the turn directly to that specialist Agent as the
// engagement's entry actor, applying its own instructions, tool ceiling, and collaboration contacts.
export default defineEvalCase({
  id: 'harness-specialist-routing',
  description: 'Addressing @coder routes the entry turn to coder with its own tool ceiling and peer contacts.',
  source: 'ADR 0048 §2 / H4 (specialist entry routing & ceiling)',
  tags: ['collaboration', 'tool-use'],
  inbound: { text: '@coder 查一下配置规范并更新端口', sender: { id: 'master', roles: ['master'] } },
  tools: [
    { name: 'edit_code', result: 'updated port to 8080' },
    { name: 'lookup_docs', result: 'Standard port is 8080.' },
    { name: 'deploy_release', result: 'deployed' },
  ],
  agents: [
    {
      name: 'coder',
      description: 'Edits code; consults researcher for docs.',
      tools: ['edit_code'],
      collaboration: { contacts: ['researcher'] },
    },
    {
      name: 'researcher',
      description: 'Looks up documentation; read-only.',
      tools: ['lookup_docs'],
    },
  ],
  script: [
    {
      actor: 'coder',
      toolCalls: [
        { name: 'deploy_release', notOffered: true },
        { name: 'ask', args: { agent: 'researcher', question: 'What is the standard port?' } },
      ],
    },
    {
      actor: 'researcher',
      toolCalls: [{ name: 'lookup_docs', args: { topic: 'port' } }],
    },
    {
      actor: 'researcher',
      text: 'Standard port is 8080.',
    },
    {
      actor: 'coder',
      toolCalls: [{ name: 'edit_code', args: { port: 8080 } }],
    },
    {
      actor: 'coder',
      text: '已向 researcher 确认规范，并将端口更新为 8080。',
    },
  ],
  expect: {
    toolsCalled: ['lookup_docs', 'edit_code'],
    toolsNotCalled: ['deploy_release'],
    outboundContains: ['8080'],
    modelInputContains: ['## Active specialist: coder', 'You are coder.'],
    anySystemPromptContains: ['You are researcher.'],
    modelSteps: 5,
  },
});
