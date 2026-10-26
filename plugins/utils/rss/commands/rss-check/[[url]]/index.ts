import { rssMessages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../../src/channel.js';
import { getRssSubs } from '../../../src/db-store.js';
import { resolveRssConfig, type RssConfig } from '../../../src/feed.js';
import { checkSubscriptions } from '../../../src/poll.js';
import { rssRuntimeToken } from '../../../src/runtime.js';

export default defineCommand<RssConfig>({
  description: '手动触发检查 RSS 更新', descriptionI18n: { en: "Check RSS feeds for updates now" },
  params: { url: { type: 'string', default: '' } },
  async execute({ params, input, use, locale }) {
    const runtime = use(rssRuntimeToken);
    const Subs = getRssSubs(runtime.db);
    if (!Subs) return t(locale, 'databaseUnavailable');

    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input, locale);
    const targetUrl = String(params.url ?? '').trim();

    let urls: string[];
    if (targetUrl) {
      const rows = await Subs.select().where({
        url: targetUrl,
        ...subscriptionScope(channel),
      });
      if (rows.length === 0) return t(locale, 'notSubscribed');
      urls = [targetUrl];
    } else {
      const rows = await Subs.select().where({
        ...subscriptionScope(channel),
      });
      if (rows.length === 0) return t(locale, 'noSubscriptions');
      urls = [...new Set(rows.map((r) => String(r.url ?? '')).filter(Boolean))];
    }

    const result = await checkSubscriptions(runtime, { urls, locale });
    return result.text;
  },
});
