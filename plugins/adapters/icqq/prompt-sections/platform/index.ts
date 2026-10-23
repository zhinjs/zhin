import { defineAgentPromptSection } from '@zhin.js/prompt-section';

export default defineAgentPromptSection({
  title: 'ICQQ / QQ',
  content: [
    'Use the current Skill catalog; discover the intent and load the matching Skill before its private Tool.',
    'The current IM operation selects the bot Client automatically; never guess user_id or group_id.',
  ].join('\n'),
  layer: 'tools',
  order: 70,
  retention: 'preferred',
  maxChars: 1200,
  profiles: ['interactive'],
  platforms: ['icqq'],
});
