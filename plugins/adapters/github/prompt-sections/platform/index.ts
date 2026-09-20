import { defineAgentPromptSection } from '@zhin.js/prompt-section';

export default defineAgentPromptSection({
  title: 'GitHub',
  content: [
    'On GitHub, discuss Issues and Pull Requests in their current conversation context.',
    'Use github_* tools for Bot write operations; do not use mcp_github_* writes that act as a human PAT.',
    'Use a workspace and branch for multi-file changes, then report the resulting Pull Request or branch.',
  ].join('\n'),
  layer: 'tools',
  order: 70,
  retention: 'preferred',
  maxChars: 1200,
  profiles: ['interactive'],
  platforms: ['github'],
});
