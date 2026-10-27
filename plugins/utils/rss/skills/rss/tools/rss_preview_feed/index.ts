import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { fetchFeed } from '../../../../src/feed.js';
import { rssRuntimeToken } from '../../../../src/runtime.js';
import { rssMessages as t } from '../../../../src/i18n.js';

export default defineAgentTool<{ url: string }>({
  description: '预览一个 RSS 源的最新内容',
  inputSchema: z.object({ url: z.string().min(1) }),
  async execute({ url }, context) {
    if (!url) return t(context.locale, 'urlRequired');
    try {
      const runtime = context.use(rssRuntimeToken);
      const { title, items } = await fetchFeed(url, runtime.config.timeout);
      if (items.length === 0) return t(context.locale, 'toolPreviewEmpty', { title });
      return items
        .slice(0, 5)
        .map((item, i) => `${i + 1}. ${item.title}\n   ${item.link}`)
        .join('\n');
    } catch (e) {
      return t(context.locale, 'toolPreviewFailed', { error: (e as Error).message });
    }
  },
});
