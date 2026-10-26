import { rssMessages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { fetchFeed, formatFeedPreview, resolveRssConfig, type RssConfig } from '../../../src/feed.js';

export default defineCommand<RssConfig>({
  description: '预览一个 RSS 源的最新内容（不订阅）', descriptionI18n: { en: "Preview the latest feed items without subscribing" },
  params: { url: { type: 'string' } },
  async execute({ params, config, locale }) {
    const url = String(params.url ?? '').trim();
    if (!url) return t(locale, 'urlRequired');
    if (!/^https?:\/\//i.test(url)) return t(locale, 'httpRequired');
    const cfg = resolveRssConfig(config);
    try {
      const { title, items } = await fetchFeed(url, cfg.timeout);
      return formatFeedPreview(title, items, locale);
    } catch (e) {
      return t(locale, 'previewFailed', { error: (e as Error).message });
    }
  },
});
