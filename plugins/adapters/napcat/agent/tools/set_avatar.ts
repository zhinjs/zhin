import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; file: string }>({
  description: '修改 QQ 头像。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    file: z.string().describe('图片（URL 或 base64）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['头像', 'avatar', '设置头像', '换头像'],
  async execute({ endpoint_id, file }: { endpoint_id: string; file: string }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.setQQAvatar(file);
      return { success: true };
  },
});
