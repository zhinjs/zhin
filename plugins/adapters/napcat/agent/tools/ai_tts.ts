import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; group_id: number; character: string; text: string }>({
  description: 'AI 文字转语音，在群聊中发送 AI 语音消息。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
    character: z.string().describe('AI 语音角色 ID（可先用 napcat_get_ai_characters 查询）'),
    text: z.string().describe('要转为语音的文字'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['AI语音', 'TTS', '文字转语音', 'ai record'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id, character, text }: { endpoint_id: string; group_id: number; character: string; text: string }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.sendGroupAiRecord(group_id, character, text);
  },
});
