import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number; character: string; text: string }>({
  description: 'AI 文字转语音，在群聊中发送 AI 语音消息。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
    character: z.string().describe('AI 语音角色 ID（可先用 napcat_get_ai_characters 查询）'),
    text: z.string().describe('要转为语音的文字'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['AI语音', 'TTS', '文字转语音', 'ai record'],
  scopes: ['group'],
  async execute({ group_id, character, text }: { group_id: number; character: string; text: string }, context) {
    const endpoint = context.$client;
      return endpoint.sendGroupAiRecord(group_id, character, text);
  },
});
