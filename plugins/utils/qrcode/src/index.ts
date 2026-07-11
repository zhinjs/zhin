import { formatCompact, MessageCommand, usePlugin } from 'zhin.js';
import { qrImageSegment } from './qrcode-lib.js';

const { addCommand, logger } = usePlugin();

const QR_API_BASE = 'https://api.qrserver.com/v1';

addCommand(
  new MessageCommand('二维码 <text:text>')
    .desc('根据文本或链接生成二维码图片')
    .action(async (_message, result) => {
      const text = result.params.text;
      logger.debug(formatCompact({ op: 'generate', len: text.length }));
      return qrImageSegment(text);
    }),
);

addCommand(
  new MessageCommand('扫码 <url:text>')
    .desc('识别图片中的二维码内容')
    .action(async (_message, result) => {
      const imageUrl = result.params.url;
      const apiUrl = `${QR_API_BASE}/read-qr-code/?fileurl=${encodeURIComponent(imageUrl)}`;
      try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
          return '二维码识别服务请求失败';
        }
        const data = (await response.json()) as Array<{
          symbol: Array<{ data: string | null; error: string | null }>;
        }>;
        const symbol = data?.[0]?.symbol?.[0];
        if (!symbol || symbol.error || !symbol.data) {
          return `未能识别二维码内容${symbol?.error ? `：${symbol.error}` : ''}`;
        }
        return `识别结果：${symbol.data}`;
      } catch (e) {
        logger.warn(formatCompact({ op: 'scan', ok: false, error: e instanceof Error ? e.message : String(e) }));
        return '二维码识别失败，请检查图片链接是否有效';
      }
    }),
);
