import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前群可用的 AI 语音角色列表，用于 napcat_ai_tts 的 character 参数。',
  inputSchema: z.object({}),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['AI角色', 'ai characters', '语音角色'],
  scopes: ['group'],
  async execute(_input, context) {
    return context.$client.getAiCharacters(currentGroup(context));
  },
});
