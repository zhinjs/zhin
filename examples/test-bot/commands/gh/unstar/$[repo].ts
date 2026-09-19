import { defineCommand } from 'zhin.js/command';
import { ghApiMessage, resolveGhClient } from '../../../lib/github-api.js';

export default defineCommand({
  description: '取消 Star',
  params: { repo: { type: 'string' } },
  execute: async (context) => {
    const { params } = context;
    const api = await resolveGhClient(context);
    if (typeof api === 'string') return api;
    const repo = String(params.repo);
    const r = await api.unstarRepo(repo);
    return r.ok ? `已取消 Star ${repo}` : ghApiMessage(r.data, '操作失败');
  },
});
