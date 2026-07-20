import { defineCommand } from '@zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: '列出 Issue',
  execute: async ({ params, input }) => {
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const r = await api.listIssues(String(params.repo), 'open');
    if (!r.ok) return ghApiMessage(r.data, '查询失败');
    const issues = (r.data as Array<{
      pull_request?: unknown;
      number: number;
      title: string;
      user?: { login?: string };
      labels?: Array<{ name?: string }>;
    }>).filter((i) => !i.pull_request);
    if (!issues.length) return '没有 open 状态的 Issue';
    return issues.slice(0, 15).map((i) => {
      const lbls = i.labels?.map((l) => l.name).filter(Boolean).join(', ') || '';
      return `#${i.number} ${i.title}\n   ${i.user?.login ?? '?'}${lbls ? ` | ${lbls}` : ''}`;
    }).join('\n\n');
  },
});
