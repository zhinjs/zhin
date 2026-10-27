/**
 * 扫码登录（Experimental，非官方 Web 接口 `passport.bilibili.com/x/passport-login/web/qrcode/*`）。
 *
 * 参考（只借流程，未复制代码）：renmu123/biliAPI WebQrcodeLogin、WittF/bilibili-qr-login、
 * Ninzore/bilibili-captain Login.loginQR、Janson20/BiliCommentBot。
 *
 * 流程：generate → 用户用 B 站 App 扫码确认 → poll 返回 code 0，跳转 URL 的查询参数里带
 * `SESSDATA` / `bili_jct` / `DedeUserID` / `Expires`。只解析这几个字段，永远不记录它们。
 *
 * 二维码内容（含 qrcode_key）等同于一次性登录凭据：只在本机生成图片，不交给任何第三方二维码服务，也不写日志。
 */
import { BilibiliApiError, type BilibiliFetch } from './client.js';

export interface BilibiliCredentials {
  readonly sessdata: string;
  readonly biliJct: string;
  /** 账号 uid（DedeUserID）。 */
  readonly mid?: string;
  /** Cookie 过期时间（毫秒时间戳），未知时省略。 */
  readonly expiresAt?: number;
  /** 扫码成功时返回的 refresh_token（用于后续 Cookie 刷新，v1.1）；拿不到时省略。敏感。 */
  readonly refreshToken?: string;
  /** 扫码时间（毫秒时间戳）。 */
  readonly obtainedAt?: number;
}

/** 0 成功；86101 未扫码；86090 已扫码待确认；86038 二维码已失效。 */
export const QR_POLL_SUCCESS = 0;
export const QR_POLL_WAITING = 86101;
export const QR_POLL_SCANNED = 86090;
export const QR_POLL_EXPIRED = 86038;

/** 二维码有效期（B 站约 180 秒）。 */
export const QR_LIFETIME_MS = 180_000;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (zhin.js adapter-bilibili; experimental)';

export interface BilibiliQrCode {
  /** 要编码进二维码的内容（App 扫这个）。敏感：不要记录。 */
  readonly url: string;
  readonly key: string;
}

export type BilibiliQrPollResult =
  | { readonly state: 'waiting' }
  | { readonly state: 'scanned' }
  | { readonly state: 'expired' }
  | { readonly state: 'confirmed'; readonly credentials: BilibiliCredentials };

async function getJson<T>(fetch: BilibiliFetch, url: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new BilibiliApiError(-response.status, `Bilibili HTTP ${response.status}`, response.status);
  const envelope = await response.json() as { code?: number; message?: string; data?: T };
  if (typeof envelope?.code !== 'number') throw new BilibiliApiError(-1, 'Malformed Bilibili response');
  if (envelope.code !== 0) throw new BilibiliApiError(envelope.code, `Bilibili API ${envelope.code}: ${envelope.message ?? ''}`.trim());
  return envelope.data as T;
}

export async function generateLoginQr(fetch: BilibiliFetch, passportBaseUrl: string): Promise<BilibiliQrCode> {
  const data = await getJson<{ url?: string; qrcode_key?: string }>(fetch,
    `${passportBaseUrl}/x/passport-login/web/qrcode/generate`);
  if (!data?.url || !data.qrcode_key) throw new BilibiliApiError(-1, 'Bilibili did not return a login QR code');
  return Object.freeze({ url: data.url, key: data.qrcode_key });
}

export async function pollLoginQr(fetch: BilibiliFetch, passportBaseUrl: string, key: string, now = Date.now()): Promise<BilibiliQrPollResult> {
  const data = await getJson<{ code?: number; url?: string; refresh_token?: string }>(fetch,
    `${passportBaseUrl}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`);
  switch (data?.code) {
    case QR_POLL_SUCCESS: {
      const credentials = credentialsFromLoginUrl(data.url ?? '', now, data.refresh_token);
      if (!credentials) throw new BilibiliApiError(-1, 'Bilibili login succeeded without cookies');
      return { state: 'confirmed', credentials };
    }
    case QR_POLL_SCANNED: return { state: 'scanned' };
    case QR_POLL_EXPIRED: return { state: 'expired' };
    case QR_POLL_WAITING: return { state: 'waiting' };
    default: throw new BilibiliApiError(Number(data?.code ?? -1), `Unexpected Bilibili QR status ${String(data?.code)}`);
  }
}

/** 从登录成功的跳转 URL 里取 Cookie。字段不全返回 undefined。 */
export function credentialsFromLoginUrl(url: string, now = Date.now(), refreshToken?: string): BilibiliCredentials | undefined {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return undefined;
  }
  const sessdata = params.get('SESSDATA')?.trim();
  const biliJct = params.get('bili_jct')?.trim();
  if (!sessdata || !biliJct) return undefined;
  const mid = params.get('DedeUserID')?.trim();
  const expires = Number(params.get('Expires'));
  // 跳转参数里的 Expires 是秒级时间戳；少数情况下给的是相对秒数。
  const expiresAt = Number.isFinite(expires) && expires > 0
    ? (expires > 1e9 ? expires * 1000 : now + expires * 1000) : undefined;
  return Object.freeze({
    sessdata,
    biliJct,
    ...(mid && /^\d+$/u.test(mid) ? { mid } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(refreshToken?.trim() ? { refreshToken: refreshToken.trim() } : {}),
    obtainedAt: now,
  });
}

export function isCredentials(value: unknown): value is BilibiliCredentials {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sessdata === 'string' && entry.sessdata.length > 0
    && typeof entry.biliJct === 'string' && entry.biliJct.length > 0;
}
