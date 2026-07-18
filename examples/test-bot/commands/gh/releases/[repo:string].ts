import { defineCommand } from '@zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: '查看发布列表',
  execute: async ({ params, input }) => {
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const r = await api.listReleases(String(params.repo), 10);
    if (!r.ok) return ghApiMessage(r.data, '查询失败');
    const releases = r.data as Array<{
      prerelease?: boolean;
      tag_name?: string;
      name?: string;
      published_at?: string;
      author?: { login?: string };
    }>;
    if (!releases.length) return '暂无发布';
    return releases.map((rel) =>
      `${rel.prerelease ? '[pre] ' : ''}${rel.tag_name} — ${rel.name || '(no title)'}\n   ${rel.published_at?.split('T')[0]} | ${rel.author?.login ?? '?'}`,
    ).join('\n\n');
  },
});
