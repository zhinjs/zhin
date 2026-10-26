import { rssMessages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../src/channel.js';
import { getRssSubs } from '../../src/db-store.js';
import { resolveRssConfig, type RssConfig } from '../../src/feed.js';
import { rssRuntimeToken } from '../../src/runtime.js';

export default defineCommand<RssConfig>({
  description: '查看当前会话的所有 RSS 订阅', descriptionI18n: { en: "List this conversation's RSS subscriptions" },
  async execute({ config, input, use, locale, formatCommand }) {
    const Subs = getRssSubs(use(rssRuntimeToken).db);
    if (!Subs) return t(locale, 'databaseUnavailable');

    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input, locale);
    const cfg = resolveRssConfig(config);
    const rows = await Subs.select().where({
      ...subscriptionScope(channel),
    });

    if (rows.length === 0) {
      const command = formatCommand('rss-add');
      return [t(locale, 'empty'), command ? t(locale, 'addHint', { command }) : undefined].filter(Boolean).join('\n');
    }

    const lines = rows.map((r, i) => {
      const title = String(r.feed_title || t(locale, 'unknownTitle'));
      return `${i + 1}. ${title}\n   ${String(r.url ?? '')}`;
    });

    return t(locale, 'list', { count: rows.length, max: cfg.maxPerGroup, items: lines.join('\n') });
  },
});
