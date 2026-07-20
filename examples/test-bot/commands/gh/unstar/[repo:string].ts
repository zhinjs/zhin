import { defineCommand } from '@zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: '取消 Star',
  execute: async ({ params, input }) => {
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const repo = String(params.repo);
    const r = await api.unstarRepo(repo);
    return r.ok ? `已取消 Star ${repo}` : ghApiMessage(r.data, '操作失败');
  },
});
