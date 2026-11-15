import { defineEvalCase } from '../framework/index.js';

const LONG_DESCRIPTION = [
  'Write the weekly engineering report from merged PRs and closed issues.',
  'Second line with internal routing notes that should never be resident in the prompt.',
].join('\n');

export default defineEvalCase({
  id: 'context-skill-catalog-compact',
  description: 'Skills are listed by name with their first sentence, Use when clause, trigger words and keywords; instructions and other description sentences stay out of the prompt until loaded.',
  source: '#729 M2.3: the plugin-runtime bootstrap injected every skill description in full on every turn; #1250 b27: the 40-character clip dropped the Triggers words',
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
    {
      name: 'github',
      description: 'Prepare GitHub issues, pull requests, reviews, and release notes for Zhin projects. '
        + 'Use when asked to write an issue, PR description, or review comment. '
        + 'Background that only matters once loaded. Triggers: 写 issue, PR 描述, 提 PR.',
      keywords: ['github', 'pull request', 'PR 描述', '发布说明'],
      instructions: 'GITHUB-INSTRUCTIONS: follow the PR template.',
    },
  ],
  script: [{ text: '你好，有什么可以帮你？' }],
  expect: {
    systemPromptContains: [
      '## Available skills',
      // Whole first sentence: the catalog no longer clips each entry to 40 characters.
      '- weekly-report: Write the weekly engineering report from merged PRs and closed issues',
      '- release-notes: Draft release notes from changesets',
      // `Use when` clause, `Triggers:` words and frontmatter keywords reach the catalog.
      '- github: Prepare GitHub issues, pull requests, reviews, and release notes for Zhin projects'
        + ' | Use when asked to write an issue, PR description, or review comment'
        + ' | Triggers: 写 issue, PR 描述, 提 PR, github, pull request, 发布说明',
      'load_skill(name)',
    ],
    systemPromptNotContains: [
      'WEEKLY-REPORT-INSTRUCTIONS', 'RELEASE-NOTES-INSTRUCTIONS', 'GITHUB-INSTRUCTIONS',
      // Description sentences other than the first and the Use when clause stay out.
      'internal routing notes', 'Background that only matters once loaded',
    ],
    modelInputNotContains: ['WEEKLY-REPORT-INSTRUCTIONS', 'RELEASE-NOTES-INSTRUCTIONS', 'GITHUB-INSTRUCTIONS'],
    contextBudget: { maxSegmentTokens: { skill_catalog: 130 } },
    modelSteps: 1,
  },
});
