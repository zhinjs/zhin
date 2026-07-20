import { defineCommand } from '@zhin.js/command';

const QR_API_BASE = 'https://api.qrserver.com/v1';

export default defineCommand({
  description: '识别图片中的二维码内容',
  async execute({ params }) {
    const imageUrl = String(params.url);
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
      console.warn(`[qrcode] scan failed: ${e instanceof Error ? e.message : String(e)}`);
      return '二维码识别失败，请检查图片链接是否有效';
    }
  },
});
