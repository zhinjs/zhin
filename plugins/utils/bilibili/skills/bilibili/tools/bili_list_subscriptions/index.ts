import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { bilibiliRuntimeToken } from '../../../../src/runtime.js';
import { getBiliSubs } from '../../../../src/store.js';

export default defineAgentTool({
  description: '列出所有 B 站 UP 主订阅（按会话分组）',
  requiresApproval: 'never',
  tags: ['bilibili'],
  keywords: ['b站订阅', 'up主', 'bilibili subscriptions'],
  inputSchema: z.object({}),
  async execute(_input, context) {
    const Subs = getBiliSubs(context.use(bilibiliRuntimeToken).db);
    if (!Subs) return 'B 站订阅数据库尚未就绪';
    const rows = await Subs.select();
    if (rows.length === 0) return '暂无任何 B 站订阅';
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const key = `${String(row.channel_type)}:${String(row.channel_id)}`;
      const list = grouped.get(key) ?? [];
      list.push(`${String(row.uname || row.uid)}（UID ${String(row.uid)}，${String(row.kinds || 'all')}）`);
      grouped.set(key, list);
    }
    const lines: string[] = [];
    for (const [channel, subs] of grouped) {
      lines.push(`[${channel}]`);
      for (const sub of subs) lines.push(`  - ${sub}`);
    }
    return `B 站订阅总览 (${rows.length} 条)：\n${lines.join('\n')}`;
  },
});
