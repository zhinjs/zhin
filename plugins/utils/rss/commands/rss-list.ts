import { defineCommand } from '@zhin.js/command';
import { extractChannelInfo } from '../src/channel.js';
import { getRssSubs } from '../src/db-store.js';
import { resolveRssConfig, type RssConfig } from '../src/feed.js';

export default defineCommand<RssConfig>({
  description: '查看当前会话的所有 RSS 订阅',
  async execute({ config, input }) {
    const Subs = getRssSubs();
    if (!Subs) return 'RSS 数据库尚未就绪';

    const channel = extractChannelInfo(input);
    const cfg = resolveRssConfig(config);
    const rows = await Subs.select().where({
      adapter_name: channel.adapterName,
      channel_type: channel.channelType,
      channel_id: channel.channelId,
    });

    if (rows.length === 0) {
      return '当前会话没有订阅任何 RSS 源\n使用 rss-add <URL> 添加订阅';
    }

    const lines = rows.map((r, i) => {
      const title = String(r.feed_title || '(未知标题)');
      return `${i + 1}. ${title}\n   ${String(r.url ?? '')}`;
    });

    return `当前订阅 (${rows.length}/${cfg.maxPerGroup})：\n${lines.join('\n')}`;
  },
});
