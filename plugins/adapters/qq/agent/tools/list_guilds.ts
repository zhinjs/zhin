import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getQqAgentDeps } from '../../src/qq-agent-deps.js';

export default defineTool<{ endpoint_id: string }>({
  description: '获取 QQ 频道列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
  }),
  platforms: ['qq'],
  tags: ['qq'],
  async execute({ endpoint_id  }: { endpoint_id: string }) {
    const endpoint = getQqAgentDeps().getEndpoint(endpoint_id);
    const guilds = await endpoint.getGuilds();
    return { guilds, count: guilds.length };
  },
});
