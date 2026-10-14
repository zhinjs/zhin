import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'context-skill-loaded-on-demand',
  description: 'load_skill returns the skill instructions to the model on demand.',
  source: '#729 M2.3: progressive disclosure on the FullAgentTurnEngine path',
  tags: ['context', 'tool-use'],
  inbound: { text: '帮我写这周的周报' },
  skills: [
    {
      name: 'weekly-report',
      description: 'Write the weekly engineering report.',
      instructions: 'WEEKLY-REPORT-INSTRUCTIONS: group PRs by package, then summarise.',
    },
  ],
  script: [
    { toolCalls: [{ name: 'load_skill', args: { name: 'weekly-report' } }] },
    { text: '周报会按包分组。你想覆盖哪几个仓库？' },
  ],
  expect: {
    modelInputContains: ['WEEKLY-REPORT-INSTRUCTIONS'],
    systemPromptNotContains: ['WEEKLY-REPORT-INSTRUCTIONS'],
    outboundContains: ['按包分组'],
    modelSteps: 2,
  },
});
