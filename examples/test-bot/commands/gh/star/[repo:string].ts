import { defineCommand } from '@zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: 'Star 仓库',
  execute: async ({ params, input }) => {
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const repo = String(params.repo);
    const r = await api.starRepo(repo);
    return r.ok ? `已 Star ${repo}` : ghApiMessage(r.data, 'Star 失败');
  },
});
