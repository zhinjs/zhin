import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineTool<{
  endpoint_id: string;
  channel_id: string;
}>({
  description: '恢复已归档的 Slack 频道',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel_id: z.string().describe('频道 ID'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  permissions: [platformPermit('workspace_admin')],
  async execute({ endpoint_id, channel_id }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const success = await endpoint.unarchiveChannel(channel_id);
    return { success, message: success ? '频道已恢复' : '操作失败' };
  },
});
