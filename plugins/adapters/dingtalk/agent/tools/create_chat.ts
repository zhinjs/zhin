import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getDingtalkAgentDeps } from '../../src/dingtalk-agent-deps.js';
import { platformPermit } from '../../src/platform-permit.js';

export default defineTool<{ endpoint_id: string; name: string; owner: string; members: string }>({
  description: '创建钉钉群聊',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    name: z.string().describe('群名'),
    owner: z.string().describe('群主用户 ID'),
    members: z.string().describe('成员用户 ID 列表，逗号分隔'),
  }),
  platforms: ['dingtalk'],
  tags: ['dingtalk'],
  permissions: [platformPermit('chat_owner')],
  async execute({ endpoint_id, name, owner, members    }: { endpoint_id: string; name: string; owner: string; members: string }) {
    const endpoint = getDingtalkAgentDeps().getEndpoint(endpoint_id);
    const chatId = await endpoint.createChat(name, owner, members.split(','));
    return { success: !!chatId, chat_id: chatId, message: chatId ? `群聊创建成功: ${chatId}` : '创建失败' };
  },
});

