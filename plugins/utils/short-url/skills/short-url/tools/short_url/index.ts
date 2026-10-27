import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { isValidUrl, shortenUrl } from '../../../../src/short-url-lib.js';
import { messages as t } from '../../../../src/i18n.js';

export default defineAgentTool<{ url: string }>({
  description: '缩短一个 URL，返回短链接',
  inputSchema: z.object({ url: z.string().min(1) }),
  keywords: ['短链', '缩短', 'shorten', 'short url'],
  async execute({ url }, context) {
    if (!isValidUrl(url)) return t(context.locale, 'toolInvalid');
    try {
      return await shortenUrl(url, context.locale);
    } catch (e: unknown) {
      return t(context.locale, 'shortFailed', { detail: e instanceof Error ? e.message : String(e) });
    }
  },
});
