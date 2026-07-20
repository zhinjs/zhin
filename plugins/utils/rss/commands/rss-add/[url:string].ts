import { defineCommand } from '@zhin.js/command';
import { extractChannelInfo } from '../../src/channel.js';
import { getRssSeen, getRssSubs } from '../../src/db-store.js';
import { fetchFeed, resolveRssConfig, type RssConfig } from '../../src/feed.js';
import { markItemsSeen } from '../../src/poll.js';

export default defineCommand<RssConfig>({
  description: '订阅一个 RSS/Atom 源',
  async execute({ params, config, input }) {
    const Subs = getRssSubs();
    if (!Subs) return 'RSS 数据库尚未就绪，请稍后重试';

    const url = String(params.url ?? '').trim();
    if (!url) return '请提供 RSS 源地址，格式：rss-add <URL>';
    if (!/^https?:\/\//i.test(url)) return '请提供有效的 HTTP/HTTPS 地址';

    const channel = extractChannelInfo(input);
    const cfg = resolveRssConfig(config);

    const existing = await Subs.select().where({
      url,
      adapter_name: channel.adapterName,
      channel_type: channel.channelType,
      channel_id: channel.channelId,
    });
    if (existing.length > 0) return '当前会话已订阅该源，无需重复添加';

    const currentSubs = await Subs.select().where({
      adapter_name: channel.adapterName,
      channel_type: channel.channelType,
      channel_id: channel.channelId,
    });
    if (currentSubs.length >= cfg.maxPerGroup) {
      return `当前会话订阅数已达上限 (${cfg.maxPerGroup})，请先取消一些`;
    }

    let feedTitle = '';
    try {
      const { title, items } = await fetchFeed(url, cfg.timeout);
      feedTitle = title;
      await markItemsSeen(url, items);
    } catch (e) {
      return `无法解析该地址: ${(e as Error).message}\n请确认是有效的 RSS/Atom 源`;
    }

    await Subs.insert({
      url,
      feed_title: feedTitle,
      adapter_name: channel.adapterName,
      endpoint_id: channel.endpointId,
      channel_type: channel.channelType,
      channel_id: channel.channelId,
      creator_id: channel.senderId,
      creator_name: channel.senderName,
      created_at: new Date().toISOString(),
    });

    return `订阅成功！\n源: ${feedTitle || url}\n新内容将在轮询时推送到本会话（需 OutboundHost）`;
  },
});
