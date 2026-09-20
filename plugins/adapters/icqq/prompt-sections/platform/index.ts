import { defineAgentPromptSection } from '@zhin.js/prompt-section';

export default defineAgentPromptSection({
  title: 'ICQQ / QQ',
  content: [
    'ICQQ capabilities are grouped into directory, interaction, group-admin, and group-state Skills.',
    'Use discover for the user intent, then load only the matching Skill before calling its private Tool.',
    'The current IM operation selects the bot Client automatically; never guess user_id or group_id.',
  ].join('\n'),
  layer: 'tools',
  order: 70,
  retention: 'preferred',
  maxChars: 1200,
  profiles: ['interactive'],
  platforms: ['icqq'],
});
