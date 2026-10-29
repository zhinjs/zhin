import { defineEvalCase } from '../framework/index.js';

const LONG_DESCRIPTION = [
  'Write the weekly engineering report from merged PRs and closed issues.',
  'Second line with internal routing notes that should never be resident in the prompt.',
].join('\n');

export default defineEvalCase({
  id: 'context-skill-catalog-compact',
  description: 'Skills are listed by name and a one-line trigger; instructions and extra description lines stay out of the prompt until loaded.',
  source: '#729 M2.3: the plugin-runtime bootstrap injected every skill description in full on every turn',
  tags: ['context'],
  inbound: { text: '你好' },
  skills: [
    {
      name: 'weekly-report',
      description: LONG_DESCRIPTION,
      instructions: 'WEEKLY-REPORT-INSTRUCTIONS: group PRs by package, then summarise.',
    },
    {
      name: 'release-notes',
      description: 'Draft release notes from changesets',
      instructions: 'RELEASE-NOTES-INSTRUCTIONS: read .changeset first.',
    },
  ],
  script: [{ text: '你好，有什么可以帮你？' }],
  expect: {
    systemPromptContains: [
      '## Available skills',
      '- weekly-report: Write the weekly engineering report…',
      '- release-notes: Draft release notes from changesets',
      'load_skill(name)',
    ],
    systemPromptNotContains: ['WEEKLY-REPORT-INSTRUCTIONS', 'RELEASE-NOTES-INSTRUCTIONS', 'internal routing notes'],
    modelInputNotContains: ['WEEKLY-REPORT-INSTRUCTIONS', 'RELEASE-NOTES-INSTRUCTIONS'],
    contextBudget: { maxSegmentTokens: { skill_catalog: 120 } },
    modelSteps: 1,
  },
});
