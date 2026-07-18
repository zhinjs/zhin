import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineAgentTool<{
  endpoint_id: string;
  channel: string;
  users: string;
}>({
  description: '邀请用户加入 Slack 频道',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel: z.string().describe('频道 ID'),
    users: z.string().describe('用户 ID 列表（逗号分隔）'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  permissions: [platformPermit('channel_manager')],
  async execute({ endpoint_id, channel, users }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const success = await endpoint.inviteToChannel(channel, users.split(','));
    return { success, message: success ? '已邀请用户加入频道' : '操作失败' };
  },
});
