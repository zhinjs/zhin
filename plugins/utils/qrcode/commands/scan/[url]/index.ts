import { defineCommand } from 'zhin.js/command';
import { messages as t } from '../../../src/i18n.js';
import { isScannableImageUrl } from '../../../src/qrcode-lib.js';

const QR_API_BASE = 'https://api.qrserver.com/v1';
const SCAN_TIMEOUT_MS = 10_000;

export default defineCommand({
  description: '识别图片中的二维码内容', descriptionI18n: { en: "Read QR code content from an image" },
  alias: ['qrcode scan', '识别二维码'],
  preferredAliasI18n: { 'zh-CN': '识别二维码', en: 'qrcode scan' },
  params: { url: { type: 'string' } },
  async execute({ params, locale }) {
    const imageUrl = String(params.url).trim();
    if (!isScannableImageUrl(imageUrl)) return t(locale, 'invalidUrl');
    const apiUrl = `${QR_API_BASE}/read-qr-code/?fileurl=${encodeURIComponent(imageUrl)}`;
    try {
      const response = await fetch(apiUrl, { signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel();
        return t(locale, 'requestFailed');
      }
      const data = (await response.json()) as Array<{
        symbol: Array<{ data: string | null; error: string | null }>;
      }>;
      const symbol = data?.[0]?.symbol?.[0];
      if (!symbol || symbol.error || !symbol.data) {
        return t(locale, 'notFound', { detail: symbol?.error ? `: ${symbol.error}` : '' });
      }
      return t(locale, 'result', { text: symbol.data });
    } catch (e) {
      console.warn(`[qrcode] scan failed: ${e instanceof Error ? e.message : String(e)}`);
      return t(locale, 'failed');
    }
  },
});
