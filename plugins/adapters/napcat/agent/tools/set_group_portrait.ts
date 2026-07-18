import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; group_id: number; file: string }>({
  description: '设置群头像。file 为图片 URL 或 base64。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
    file: z.string().describe('图片（URL 或 base64）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['群头像', 'group portrait', '设置群头像'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id, file }: { endpoint_id: string; group_id: number; file: string }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.setGroupPortrait(group_id, file);
      return { success: true };
  },
});
