import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getRssSubs } from '../../../../src/db-store.js';
import { rssRuntimeToken } from '../../../../src/runtime.js';
import { rssMessages as t } from '../../../../src/i18n.js';

export default defineAgentTool({
  description: '查询当前所有 RSS 订阅',
  inputSchema: z.object({}),
  async execute(_input, context) {
    const Subs = getRssSubs(context.use(rssRuntimeToken).db);
    if (!Subs) return t(context.locale, 'databaseUnavailable');

    const all = (await Subs.select()) as Array<{
      channel_type: string;
      channel_id: string;
      feed_title?: string;
      url: string;
    }>;
    if (all.length === 0) return t(context.locale, 'allEmpty');

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
    return t(context.locale, 'allList', { count: all.length, items: lines.join('\n') });
  },
});
