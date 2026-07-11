import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getDingtalkAgentDeps } from '../../src/dingtalk-agent-deps.js';
export default defineTool<{ endpoint_id: string; chat_id: string; name?: string; owner?: string; add_members?: string; remove_members?: string }>({
  description: '更新钉钉群聊设置（改名、换群主、增减成员）',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('群聊 ID'),
    name: z.string().optional().describe('新群名（可选）'),
    owner: z.string().optional().describe('新群主 userId（可选）'),
    add_members: z.string().optional().describe('要添加的成员 userId，逗号分隔（可选）'),
    remove_members: z.string().optional().describe('要移除的成员 userId，逗号分隔（可选）'),
  }),
  platforms: ['dingtalk'],
  tags: ['dingtalk'],
  async execute({ endpoint_id, chat_id, name, owner, add_members, remove_members    }: { endpoint_id: string; chat_id: string; name?: string; owner?: string; add_members?: string; remove_members?: string }) {
    const endpoint = getDingtalkAgentDeps().getEndpoint(endpoint_id);
    const options: Record<string, unknown> = {};
    if (name) options.name = name;
    if (owner) options.owner = owner;
    if (add_members) options.add_useridlist = add_members.split(',').map((s: string) => s.trim());
    if (remove_members) options.del_useridlist = remove_members.split(',').map((s: string) => s.trim());
    await endpoint.updateChat(chat_id, options);
    return { success: true, message: '群聊设置已更新' };
  },
});

