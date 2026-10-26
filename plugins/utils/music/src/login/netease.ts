import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import type { QrLoginProvider, QrCreateResult, QrPollResult } from './types.js';
import { extractSetCookies } from './types.js';

const QR_IMAGE_API = 'https://api.qrserver.com/v1/create-qr-code/';

export class NeteaseLoginProvider implements QrLoginProvider {
  async createQr(locale: Locale = 'zh-CN'): Promise<QrCreateResult> {
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
      throw new Error(t(locale, 'neteaseQr'));
    }

    const loginUrl = `https://music.163.com/login?codekey=${keyData.unikey}`;
    const imageUrl = `${QR_IMAGE_API}?size=300x300&data=${encodeURIComponent(loginUrl)}`;

    return {
      imageSegment: { type: 'image', data: { url: imageUrl } },
      pollData: { unikey: keyData.unikey },
    };
  }

  async pollQr(pollData: Record<string, string>, locale: Locale = 'zh-CN'): Promise<QrPollResult> {
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
          return { status: 'waiting', message: t(locale, 'waiting') };
        case 802:
          return { status: 'scanned', message: t(locale, 'scanned') };
        case 800:
          return { status: 'expired', message: t(locale, 'expired') };
        case 803: {
          const cookie = extractSetCookies(response.headers);
          return {
            status: 'confirmed',
            message: t(locale, 'confirmed'),
            cookie: cookie || undefined,
          };
        }
        default:
          return { status: 'error', message: data.message ?? t(locale, 'unknown') };
      }
    } catch (err) {
      return {
        status: 'error',
        message: t(locale, 'pollFailed', { error: err instanceof Error ? err.message : String(err) }),
      };
    }
  }
}
