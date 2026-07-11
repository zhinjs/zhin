import { formatCompact, MessageCommand, usePlugin } from 'zhin.js';
import { expandUrl, isValidUrl, shortenUrl } from './short-url-lib.js';

const { addCommand, logger } = usePlugin();

addCommand(
  new MessageCommand('短链 <url:text>')
    .desc('缩短一个 URL')
    .action(async (_message, result) => {
      const url = result.params.url as string;
      if (!isValidUrl(url)) return '请提供有效的 HTTP/HTTPS 链接';
      try {
        const short = await shortenUrl(url);
        return `短链接: ${short}`;
      } catch (e: unknown) {
        logger.warn(formatCompact({ op: 'shorten', ok: false, error: e instanceof Error ? e.message : String(e) }));
        return `缩短失败: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
);

addCommand(
  new MessageCommand('展开 <url:text>')
    .desc('展开一个短链接，显示原始地址')
    .action(async (_message, result) => {
      const url = result.params.url as string;
      if (!isValidUrl(url)) return '请提供有效的 HTTP/HTTPS 链接';
      try {
        const original = await expandUrl(url);
        return `原始链接: ${original}`;
      } catch (e: unknown) {
        logger.warn(formatCompact({ op: 'expand', ok: false, error: e instanceof Error ? e.message : String(e) }));
        return `展开失败: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
);
