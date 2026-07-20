import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getWecomAgentDeps } from '../../src/wecom-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; user_id: string; content: string }>({
  description: '向指定企业微信用户发送文本消息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.string().describe('用户 ID'),
    content: z.string().describe('消息内容'),
  }),
  platforms: ['wecom'],
  tags: ['wecom'],
  async execute({ endpoint_id, user_id, content    }: { endpoint_id: string; user_id: string; content: string }) {
    const endpoint = getWecomAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.sendTextMessage(user_id, content);
    return { success, message: success ? '消息已发送' : '发送失败' };
  },
});

