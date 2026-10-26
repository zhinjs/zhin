import { rssMessages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../../src/channel.js';
import { getRssSubs } from '../../../src/db-store.js';
import { fetchFeed, resolveRssConfig, type RssConfig } from '../../../src/feed.js';
import { markItemsSeen } from '../../../src/poll.js';
import { rssRuntimeToken } from '../../../src/runtime.js';

export default defineCommand<RssConfig>({
  description: '订阅一个 RSS/Atom 源', descriptionI18n: { en: "Subscribe to an RSS/Atom feed" },
  params: { url: { type: 'string' } },
  async execute({ params, config, input, use, locale }) {
    const runtime = use(rssRuntimeToken);
    const Subs = getRssSubs(runtime.db);
    if (!Subs) return t(locale, 'databaseRetry');

    const url = String(params.url ?? '').trim();
    if (!url) return t(locale, 'urlRequired');
    if (!/^https?:\/\//i.test(url)) return t(locale, 'httpRequired');

    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input, locale);
    const cfg = resolveRssConfig(config);

    const existing = await Subs.select().where({
      url,
      ...subscriptionScope(channel),
    });
    if (existing.length > 0) return t(locale, 'existing');

    const currentSubs = await Subs.select().where({
      ...subscriptionScope(channel),
    });
    if (currentSubs.length >= cfg.maxPerGroup) {
      return t(locale, 'limit', { max: cfg.maxPerGroup });
    }

    let feedTitle = '';
    try {
      const { title, items } = await fetchFeed(url, cfg.timeout);
      feedTitle = title;
      await markItemsSeen(runtime, url, items);
    } catch (e) {
      return t(locale, 'loadFailed', { error: (e as Error).message });
    }

    await Subs.insert({
      url,
      feed_title: feedTitle,
      adapter_name: channel.adapterName,
      endpoint_id: channel.endpointKey,
      channel_type: channel.channelType,
      channel_id: channel.channelId,
      creator_id: channel.senderId,
      creator_name: channel.senderName,
      created_at: new Date().toISOString(),
      locale,
    });

    return t(locale, 'added', { feed: feedTitle || url });
  },
});
