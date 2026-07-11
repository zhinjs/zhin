import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; signature: string }>({
  description: '设置个人签名（个性签名）。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    signature: z.string().describe('签名内容'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['签名', '个性签名', 'signature', 'longnick'],
  async execute({ endpoint_id, signature }: { endpoint_id: string; signature: string }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.setSelfLongnick(signature);
      return { success: true };
  },
});
