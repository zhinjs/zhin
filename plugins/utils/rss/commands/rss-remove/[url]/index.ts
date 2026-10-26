import { rssMessages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../../src/channel.js';
import { getRssSubs } from '../../../src/db-store.js';
import type { RssConfig } from '../../../src/feed.js';
import { rssRuntimeToken } from '../../../src/runtime.js';

export default defineCommand<RssConfig>({
  description: '取消一个 RSS 订阅', descriptionI18n: { en: "Unsubscribe from an RSS feed" },
  params: { url: { type: 'string' } },
  async execute({ params, input, use, locale }) {
    const Subs = getRssSubs(use(rssRuntimeToken).db);
    if (!Subs) return t(locale, 'databaseUnavailable');

    const url = String(params.url ?? '').trim();
    if (!url) return t(locale, 'removeUrl');

    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input, locale);
    const rows = await Subs.select().where({
      url,
      ...subscriptionScope(channel),
    });

    if (rows.length === 0) return t(locale, 'notFound');

    const row = rows[0]!;
    // 表结构没有 id 列，删除必须按业务键匹配（与上面的 select 条件一致）。
    await Subs.delete().where({
      url,
      ...subscriptionScope(channel),
    });
    return t(locale, 'removed', { feed: String(row.feed_title || url) });
  },
});
