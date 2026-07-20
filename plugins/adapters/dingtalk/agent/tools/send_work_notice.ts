import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getDingtalkAgentDeps } from '../../src/dingtalk-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; user_ids: string; content: string }>({
  description: '向指定用户发送钉钉工作通知',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_ids: z.string().describe('用户 ID 列表，逗号分隔'),
    content: z.string().describe('通知内容'),
  }),
  platforms: ['dingtalk'],
  tags: ['dingtalk'],
  async execute({ endpoint_id, user_ids, content    }: { endpoint_id: string; user_ids: string; content: string }) {
    const endpoint = getDingtalkAgentDeps().getEndpoint(endpoint_id);
    const msgContent = { msgtype: 'text', text: { content } };
    const success = await endpoint.sendWorkNotice(user_ids.split(','), msgContent);
    return { success, message: success ? '工作通知已发送' : '发送失败' };
  },
});

