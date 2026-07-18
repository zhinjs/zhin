import { defineCommand } from '@zhin.js/command';
import {
  ghApiMessage,
  parsePositiveInt,
  requireRepo,
  resolveGhClient,
} from '../../lib/github-api.js';

export default defineCommand({
  description: '关闭 Issue 或 PR',
  execute: async ({ args, input }) => {
    const parsed = requireRepo(args, '用法: gh close <owner/repo> <编号>');
    if (typeof parsed === 'string') return parsed;
    const number = parsePositiveInt(parsed.rest[0], '编号');
    if (typeof number === 'string') return number;
    const api = await resolveGhClient(input);
    if (typeof api === 'string') return api;
    const ir = await api.closeIssue(parsed.repo, number);
    if (ir.ok) return `Issue #${number} 已关闭`;
    const pr = await api.closePR(parsed.repo, number);
    if (pr.ok) return `PR #${number} 已关闭`;
    return `关闭失败: ${ghApiMessage(ir.data, ghApiMessage(pr.data, '未知错误'))}`;
  },
});
