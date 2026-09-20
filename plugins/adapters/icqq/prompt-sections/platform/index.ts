import { defineAgentPromptSection } from '@zhin.js/prompt-section';

export default defineAgentPromptSection({
  title: 'ICQQ / QQ',
  content: [
    'On icqq/QQ: if icqq__send_user_like is in your tool list, call it with { user_id, times }.',
    'The current IM operation selects the bot Client automatically. user_id is the sender to like. times is 1-20.',
    'Do not claim the tool is missing until calling it this turn or load_tool("icqq__send_user_like") fails.',
    'Other social tools include icqq__poke and icqq__friend_list.',
  ].join('\n'),
  layer: 'tools',
  order: 70,
  retention: 'preferred',
  maxChars: 1200,
  profiles: ['interactive'],
  platforms: ['icqq'],
});
