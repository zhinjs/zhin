import { defineCommand } from '@zhin.js/command';
import {
  ghApiMessage,
  parsePositiveInt,
  requireRepo,
  resolveGhClient,
} from '../../lib/github-api.js';

export default defineCommand({
  description: '查看 PR 详情',
  execute: async ({ args, input }) => {
    const parsed = requireRepo(args, '用法: gh pr <owner/repo> <编号>');
    if (typeof parsed === 'string') return parsed;
    const number = parsePositiveInt(parsed.rest[0], '编号');
    if (typeof number === 'string') return number;
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const r = await api.getPR(parsed.repo, number);
    if (!r.ok) return ghApiMessage(r.data, 'PR 不存在');
    const p = r.data as {
      number: number;
      title: string;
      user?: { login?: string };
      state?: string;
      head?: { ref?: string };
      base?: { ref?: string };
      created_at?: string;
      additions?: number;
      deletions?: number;
      changed_files?: number;
      body?: string;
      html_url?: string;
    };
    return [
      `#${p.number} ${p.title}`,
      `${p.user?.login ?? '?'} | ${p.state} | ${p.head?.ref} → ${p.base?.ref}`,
      `${p.created_at?.split('T')[0]} | +${p.additions} -${p.deletions} (${p.changed_files} files)`,
      p.body ? `\n${p.body.slice(0, 800)}${p.body.length > 800 ? '...' : ''}` : '',
      p.html_url ? `\n${p.html_url}` : null,
    ].filter(Boolean).join('\n');
  },
});
