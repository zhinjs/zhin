import { defineCommand } from 'zhin.js/command';
import { ghApiMessage, ghDate, resolveGhClient } from '../../../../lib/github-api.js';

export default defineCommand({
  description: '查看仓库信息',
  params: { repo: { type: 'string' } },
  execute: async (context) => {
    const { params } = context;
    const api = await resolveGhClient(context);
    if (typeof api === 'string') return api;
    const repo = String(params.repo);
    const r = await api.getRepo(repo);
    if (!r.ok) return ghApiMessage(r.data, '仓库不存在');
    const d = r.data as {
      full_name?: string;
      private?: boolean;
      description?: string;
      stargazers_count?: number;
      forks_count?: number;
      watchers_count?: number;
      default_branch?: string;
      language?: string;
      license?: { name?: string };
      created_at?: string;
      pushed_at?: string;
      html_url?: string;
    };
    return [
      `${d.full_name}${d.private ? ' (private)' : ''}`,
      d.description ? d.description : null,
      `⭐ ${d.stargazers_count} | 🍴 ${d.forks_count} | 👀 ${d.watchers_count}`,
      `默认分支: ${d.default_branch}`,
      d.language ? `语言: ${d.language}` : null,
      d.license?.name ? d.license.name : null,
      `创建: ${ghDate(d.created_at)} | 推送: ${ghDate(d.pushed_at)}`,
      d.html_url,
    ].filter(Boolean).join('\n');
  },
});
