import { defineCommand } from '@zhin.js/command';
import { extractChannelInfo } from '../../src/channel.js';
import { getRssSubs } from '../../src/db-store.js';
import type { RssConfig } from '../../src/feed.js';

export default defineCommand<RssConfig>({
  description: '取消一个 RSS 订阅',
  async execute({ params, input }) {
    const Subs = getRssSubs();
    if (!Subs) return 'RSS 数据库尚未就绪';

    const url = String(params.url ?? '').trim();
    if (!url) return '请提供要取消的 RSS 源地址';

    const channel = extractChannelInfo(input);
    const rows = await Subs.select().where({
      url,
      adapter_name: channel.adapterName,
      channel_type: channel.channelType,
      channel_id: channel.channelId,
    });

    if (rows.length === 0) return '未找到该订阅';

    const row = rows[0]!;
    await Subs.delete().where({ id: row.id });
    return `已取消订阅: ${String(row.feed_title || url)}`;
  },
});
