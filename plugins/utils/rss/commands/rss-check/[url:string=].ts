import { defineCommand } from '@zhin.js/command';
import { extractChannelInfo } from '../../src/channel.js';
import { getRssSubs } from '../../src/db-store.js';
import { resolveRssConfig, type RssConfig } from '../../src/feed.js';
import { checkSubscriptions } from '../../src/poll.js';

export default defineCommand<RssConfig>({
  description: '手动触发检查 RSS 更新',
  async execute({ params, config, input }) {
    const Subs = getRssSubs();
    if (!Subs) return 'RSS 数据库尚未就绪';

    const channel = extractChannelInfo(input);
    const cfg = resolveRssConfig(config);
    const targetUrl = String(params.url ?? '').trim();

    let urls: string[];
    if (targetUrl) {
      const rows = await Subs.select().where({
        url: targetUrl,
        adapter_name: channel.adapterName,
        channel_type: channel.channelType,
        channel_id: channel.channelId,
      });
      if (rows.length === 0) return '当前会话未订阅该源';
      urls = [targetUrl];
    } else {
      const rows = await Subs.select().where({
        adapter_name: channel.adapterName,
        channel_type: channel.channelType,
        channel_id: channel.channelId,
      });
      if (rows.length === 0) return '当前会话没有任何订阅';
      urls = [...new Set(rows.map((r) => String(r.url ?? '')).filter(Boolean))];
    }

    const result = await checkSubscriptions({ urls, config: cfg });
    return result.text;
  },
});
