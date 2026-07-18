import { defineCommand } from '@zhin.js/command';
import { expandUrl, isValidUrl } from '../../src/short-url-lib.js';

export default defineCommand({
  description: '展开一个短链接，显示原始地址',
  async execute({ params }) {
    const url = String(params.url ?? '');
    if (!isValidUrl(url)) return '请提供有效的 HTTP/HTTPS 链接';
    try {
      const original = await expandUrl(url);
      return `原始链接: ${original}`;
    } catch (e: unknown) {
      return `展开失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});
