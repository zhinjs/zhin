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
  async execute({ endpoint_id }: { endpoint_id: string }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const gl = endpoint.gl;
    const groups = Array.from(gl.values()).map((g) => ({
      group_id: g.group_id, group_name: g.group_name,
      member_count: g.member_count, max_member_count: g.max_member_count,
    }));
    return { groups: groups.slice(0, 50), count: gl.size };
  },
});
