import type { QrLoginProvider, QrCreateResult, QrPollResult } from './types.js';
import { extractSetCookies } from './types.js';

const QR_IMAGE_API = 'https://api.qrserver.com/v1/create-qr-code/';

export class NeteaseLoginProvider implements QrLoginProvider {
  async createQr(): Promise<QrCreateResult> {
    const timestampMs = Date.now();
    const keyResp = await fetch(
      `https://music.163.com/api/login/qrcode/unikey?type=1&timestamp=${timestampMs}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `type=1&timestamp=${timestampMs}`,
      },
    );
    const keyData = (await keyResp.json()) as { code: number; unikey?: string };
    if (keyData.code !== 200 || !keyData.unikey) {
      throw new Error('获取网易云登录二维码失败');
    }

    const loginUrl = `https://music.163.com/login?codekey=${keyData.unikey}`;
    const imageUrl = `${QR_IMAGE_API}?size=300x300&data=${encodeURIComponent(loginUrl)}`;

    return {
      imageSegment: { type: 'image', data: { url: imageUrl } },
      pollData: { unikey: keyData.unikey },
    };
  }

  async pollQr(pollData: Record<string, string>): Promise<QrPollResult> {
    const { unikey } = pollData;
    try {
      const response = await fetch(
        'https://music.163.com/api/login/qrcode/client/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `key=${unikey}&type=1`,
        },
      );
      const data = (await response.json()) as { code: number; message?: string };

      switch (data.code) {
        case 801:
          return { status: 'waiting', message: '等待扫码...' };
        case 802:
          return { status: 'scanned', message: '已扫码，请在手机上确认登录' };
        case 800:
          return { status: 'expired', message: '二维码已过期，请重新发起登录' };
        case 803: {
          const cookie = extractSetCookies(response.headers);
          return {
            status: 'confirmed',
            message: '登录成功',
            cookie: cookie || undefined,
          };
        }
        default:
          return { status: 'error', message: data.message ?? '未知状态' };
      }
    } catch (err) {
      return {
        status: 'error',
        message: `轮询失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
