import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number }>({
  description: '获取 AI 语音角色列表，用于 napcat_ai_tts 的 character 参数。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['AI角色', 'ai characters', '语音角色'],
  scopes: ['group'],
  async execute({ group_id }: { group_id: number }, context) {
    const endpoint = context.$client;
      return endpoint.getAiCharacters(group_id);
  },
});
