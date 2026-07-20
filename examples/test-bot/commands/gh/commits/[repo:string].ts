import { defineCommand } from '@zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: '查看提交记录',
  execute: async ({ params, args, input }) => {
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const limitRaw = args[0];
    const limit = limitRaw ? Number(limitRaw) : 10;
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 50) : 10;
    const r = await api.listCommits(String(params.repo), undefined, undefined, n);
    if (!r.ok) return ghApiMessage(r.data, '查询失败');
    const commits = r.data as Array<{
      sha: string;
      commit?: { message?: string; author?: { name?: string; date?: string } };
    }>;
    if (!commits.length) return '没有找到提交记录';
    return commits.map((c) =>
      `• ${c.sha.substring(0, 7)} ${c.commit?.message?.split('\n')[0] ?? '?'}\n  ${c.commit?.author?.name || '?'} | ${c.commit?.author?.date?.split('T')[0] || '?'}`,
    ).join('\n\n');
  },
});
