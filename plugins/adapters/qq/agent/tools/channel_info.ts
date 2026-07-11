import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getQqAgentDeps } from '../../src/qq-agent-deps.js';

export default defineTool<{ endpoint_id: string; channel_id: string }>({
  description: '获取 QQ 频道中指定子频道的详细信息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel_id: z.string().describe('子频道 ID'),
  }),
  platforms: ['qq'],
  tags: ['qq'],
  permissions: [platformPermit('guild_admin')],
  async execute({ endpoint_id, channel_id  }: { endpoint_id: string; channel_id: string }) {
    const endpoint = getQqAgentDeps().getEndpoint(endpoint_id);
    return endpoint.getChannelInfo(channel_id);
  },
});
