import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineAgentTool<{
  endpoint_id: string;
  user_id: string;
}>({
  description: '查询 Slack 用户详细信息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.string().describe('用户 ID'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  async execute({ endpoint_id, user_id }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const user = await endpoint.getUserInfo(user_id);
    return {
      id: user.id,
      name: user.name,
      real_name: user.real_name,
      display_name: user.profile?.display_name,
      email: user.profile?.email,
      is_admin: user.is_admin,
      is_bot: user.is_bot,
      status_text: user.profile?.status_text,
    };
  },
});
