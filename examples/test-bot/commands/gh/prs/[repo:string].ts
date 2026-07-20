import { defineCommand } from '@zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: '列出 Pull Request',
  execute: async ({ params, input }) => {
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const r = await api.listPRs(String(params.repo), 'open');
    if (!r.ok) return ghApiMessage(r.data, '查询失败');
    const prs = r.data as Array<{
      number: number;
      draft?: boolean;
      title: string;
      user?: { login?: string };
      head?: { ref?: string };
      base?: { ref?: string };
    }>;
    if (!prs.length) return '没有 open 状态的 PR';
    return prs.slice(0, 15).map((p) =>
      `#${p.number} ${p.draft ? '[Draft] ' : ''}${p.title}\n   ${p.user?.login ?? '?'} | ${p.head?.ref} → ${p.base?.ref}`,
    ).join('\n\n');
  },
});
