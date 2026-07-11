import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; group_id: number }>({
  description: '获取 AI 语音角色列表，用于 napcat_ai_tts 的 character 参数。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['AI角色', 'ai characters', '语音角色'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id }: { endpoint_id: string; group_id: number }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.getAiCharacters(group_id);
  },
});
