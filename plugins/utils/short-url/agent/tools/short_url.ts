import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { isValidUrl, shortenUrl } from '../../src/short-url-lib.js';

export default defineTool<{ url: string }>({
  description: '缩短一个 URL，返回短链接',
  inputSchema: z.object({ url: z.string().min(1) }),
  keywords: ['短链', '缩短', 'shorten', 'short url'],
  async execute({ url }) {
    if (!isValidUrl(url)) return '无效的 URL，需要 http:// 或 https:// 开头';
    try {
      return await shortenUrl(url);
    } catch (e: unknown) {
      return `缩短失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});
