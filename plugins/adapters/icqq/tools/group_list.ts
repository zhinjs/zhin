import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string }>({
  description: '获取 Endpoint 的 QQ 群列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
  }),
  platforms: ['icqq'],
  approval: 'never',
  async execute({ endpoint_id }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const groups = Array.from(endpoint.gl.values()).map((group) => ({
      group_id: group.group_id,
      group_name: group.group_name,
      member_count: group.member_count,
      max_member_count: group.max_member_count,
    }));
    return { groups: groups.slice(0, 50), count: endpoint.gl.size };
  },
});
