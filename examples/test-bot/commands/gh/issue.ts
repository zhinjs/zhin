import { defineCommand } from '@zhin.js/command';
import {
  ghApiMessage,
  parsePositiveInt,
  requireRepo,
  resolveGhClient,
} from '../../lib/github-api.js';

export default defineCommand({
  description: '查看 Issue 详情',
  execute: async ({ args, input }) => {
    const parsed = requireRepo(args, '用法: gh issue <owner/repo> <编号>');
    if (typeof parsed === 'string') return parsed;
    const number = parsePositiveInt(parsed.rest[0], '编号');
    if (typeof number === 'string') return number;
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const r = await api.getIssue(parsed.repo, number);
    if (!r.ok) return ghApiMessage(r.data, 'Issue 不存在');
    const i = r.data as {
      number: number;
      title: string;
      user?: { login?: string };
      state?: string;
      created_at?: string;
      labels?: Array<{ name?: string }>;
      body?: string;
      html_url?: string;
    };
    return [
      `#${i.number} ${i.title}`,
      `${i.user?.login ?? '?'} | ${i.state} | ${i.created_at?.split('T')[0]}`,
      i.labels?.length ? i.labels.map((l) => l.name).filter(Boolean).join(', ') : null,
      i.body ? `\n${i.body.slice(0, 800)}${i.body.length > 800 ? '...' : ''}` : '',
      i.html_url ? `\n${i.html_url}` : null,
    ].filter(Boolean).join('\n');
  },
});
