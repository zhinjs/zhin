import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineTool<{
  endpoint_id: string;
  channel_id: string;
  purpose: string;
}>({
  description: '设置 Slack 频道的用途/目的',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel_id: z.string().describe('频道 ID'),
    purpose: z.string().describe('频道用途描述'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  permissions: [platformPermit('channel_manager')],
  async execute({ endpoint_id, channel_id, purpose }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const success = await endpoint.setChannelPurpose(channel_id, purpose);
    return { success, message: success ? '频道用途已更新' : '操作失败' };
  },
});
