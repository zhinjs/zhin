import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getRssAgentDeps } from '../../src/rss-agent-deps.js';

export default defineAgentTool({
  description: '查询当前所有 RSS 订阅',
  inputSchema: z.object({}),
  async execute() {
    const { getSubs } = getRssAgentDeps();
    const Subs = getSubs();
    if (!Subs) return 'RSS 数据库尚未就绪';

    const all = (await Subs.select()) as Array<{
      channel_type: string;
      channel_id: string;
      feed_title?: string;
      url: string;
    }>;
    if (all.length === 0) return '暂无任何 RSS 订阅';

    const grouped = new Map<string, typeof all>();
    for (const sub of all) {
      const key = `${sub.channel_type}:${sub.channel_id}`;
      const list = grouped.get(key) || [];
      list.push(sub);
      grouped.set(key, list);
    }

    const lines: string[] = [];
    for (const [channel, subs] of grouped) {
      lines.push(`[${channel}]`);
      for (const s of subs) {
        lines.push(`  - ${s.feed_title || s.url}`);
      }
    }
    return `RSS 订阅总览 (${all.length} 条):\n${lines.join('\n')}`;
  },
});
