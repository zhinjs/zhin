import { defineCommand } from '@zhin.js/command';
import { isValidUrl, shortenUrl } from '../../src/short-url-lib.js';

export default defineCommand({
  description: '缩短一个 URL',
  async execute({ params }) {
    const url = String(params.url ?? '');
    if (!isValidUrl(url)) return '请提供有效的 HTTP/HTTPS 链接';
    try {
      const short = await shortenUrl(url);
      return `短链接: ${short}`;
    } catch (e: unknown) {
      return `缩短失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});
