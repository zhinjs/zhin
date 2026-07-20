import { defineCommand } from '@zhin.js/command';
import {
  ghApiMessage,
  parsePositiveInt,
  requireRepo,
  resolveGhClient,
} from '../../lib/github-api.js';

export default defineCommand({
  description: '评论 Issue 或 PR',
  execute: async ({ args, input }) => {
    const parsed = requireRepo(args, '用法: gh comment <owner/repo> <编号> <内容>');
    if (typeof parsed === 'string') return parsed;
    const number = parsePositiveInt(parsed.rest[0], '编号');
    if (typeof number === 'string') return number;
    const body = parsed.rest.slice(1).join(' ').trim();
    if (!body) return '用法: gh comment <owner/repo> <编号> <内容>';
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const r = await api.createIssueComment(parsed.repo, number, body);
    return r.ok ? `已评论 #${number}` : ghApiMessage(r.data, '评论失败');
  },
});
