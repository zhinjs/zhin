import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineAgentTool<{
  endpoint_id: string;
  channel: string;
}>({
  description: '归档 Slack 频道',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel: z.string().describe('频道 ID'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  permissions: [platformPermit('workspace_admin')],
  async execute({ endpoint_id, channel }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const success = await endpoint.archiveChannel(channel);
    return { success, message: success ? '已归档频道' : '操作失败' };
  },
});
