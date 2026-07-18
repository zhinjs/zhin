import { defineCommand } from '@zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: '搜索 GitHub 仓库',
  execute: async ({ params, args, input }) => {
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const query = [String(params.query), ...args].join(' ').trim();
    if (!query) return '用法: gh search <关键词>';
    const r = await api.searchRepos(query, 10);
    if (!r.ok) return ghApiMessage(r.data, '搜索失败');
    const data = r.data as {
      total_count?: number;
      items?: Array<{ full_name?: string; stargazers_count?: number; description?: string }>;
    };
    if (!data.items?.length) return '没有匹配的仓库';
    return `共 ${data.total_count} 条，显示前 ${data.items.length}:\n\n` +
      data.items.map((repo) =>
        `${repo.full_name}  ⭐ ${repo.stargazers_count}\n   ${repo.description || '(无描述)'}`,
      ).join('\n\n');
  },
});
