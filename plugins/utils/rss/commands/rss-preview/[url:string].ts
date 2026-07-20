import { defineCommand } from '@zhin.js/command';
import { fetchFeed, formatFeedPreview, resolveRssConfig, type RssConfig } from '../../src/feed.js';

export default defineCommand<RssConfig>({
  description: '预览一个 RSS 源的最新内容（不订阅）',
  async execute({ params, config }) {
    const url = String(params.url ?? '').trim();
    if (!url) return '请提供 RSS 源地址';
    if (!/^https?:\/\//i.test(url)) return '请提供有效的 HTTP/HTTPS 地址';
    const cfg = resolveRssConfig(config);
    try {
      const { title, items } = await fetchFeed(url, cfg.timeout);
      return formatFeedPreview(title, items);
    } catch (e) {
      return `解析失败: ${(e as Error).message}\n请确认是有效的 RSS/Atom 地址`;
    }
  },
});
