import { defineCommand } from '@zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: '查看分支列表',
  execute: async ({ params, input }) => {
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const r = await api.listBranches(String(params.repo), 20);
    if (!r.ok) return ghApiMessage(r.data, '查询失败');
    const branches = r.data as Array<{ name: string; protected?: boolean }>;
    return branches.length
      ? `分支 (${branches.length}):\n${branches.map((b) => `  • ${b.name}${b.protected ? ' 🔒' : ''}`).join('\n')}`
      : '没有找到分支';
  },
});
