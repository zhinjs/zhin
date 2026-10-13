import type {
  ResolvedWeChatMpConfig,
  TokenResponse,
  WeChatAPIResponse,
} from './protocol.js';
import type { WeChatMediaUploadResult } from './media-upload.js';
import { defineEndpointClient } from 'zhin.js/adapter';

const TOKEN_INVALID_ERRCODES = new Set([40001, 40014, 42001]);

export type WeChatMpFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  },
) => Promise<{ readonly data: unknown }>;

/** Direct WeChat Official Account API client exposed to plugins. */
export class WeChatMpClient {
  #accessToken: string | null = null;
  #tokenExpireTime = 0;
  #refreshing: Promise<string> | null = null;

  constructor(
    readonly config: ResolvedWeChatMpConfig,
    readonly fetch: WeChatMpFetch,
  ) {}

  get accessToken(): string | null {
    return this.#accessToken;
  }

  get tokenExpired(): boolean {
    return !this.#accessToken || Date.now() >= this.#tokenExpireTime;
  }

  /**
   * 刷新 access_token。并发调用共享同一次请求：微信每次换取新 token 都会使旧 token
   * 进入失效倒计时，且有每日调用次数上限，重复刷新会互相顶掉并消耗配额。
   */
  refreshAccessToken(): Promise<string> {
    if (!this.#refreshing) {
      this.#refreshing = this.#fetchAccessToken().finally(() => {
        this.#refreshing = null;
      });
    }
    return this.#refreshing;
  }

  async #fetchAccessToken(): Promise<string> {
    const { appId, appSecret } = this.config;
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
    const response = await this.fetch(url);
    const data = response.data as TokenResponse & WeChatAPIResponse;
    if (!data.access_token) {
      throw new Error(data.errmsg
        ? `Failed to get access token: ${data.errcode} ${data.errmsg}`
        : 'Failed to get access token');
    }
    this.#accessToken = data.access_token;
    // expires_in 缺失/非法时 NaN 会让 tokenExpired 永远为 false；按官方默认 7200s 兜底。
    const expiresIn = Number(data.expires_in);
    const lifetimeSec = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 7200;
    this.#tokenExpireTime = Date.now() + (lifetimeSec - 300) * 1000;
    return data.access_token;
  }

  async request<T = unknown>(
    path: string,
    init?: Parameters<WeChatMpFetch>[1],
  ): Promise<T> {
    if (this.tokenExpired) await this.refreshAccessToken();
    const separator = path.includes('?') ? '&' : '?';
    const response = await this.fetch(
      `https://api.weixin.qq.com${path}${separator}access_token=${this.#accessToken}`,
      init,
    );
    return response.data as T;
  }

  async sendCustomerService(messageData: unknown): Promise<WeChatAPIResponse> {
    let result = await this.request<WeChatAPIResponse>(
      '/cgi-bin/message/custom/send',
      { method: 'POST', body: messageData },
    );
    if (result.errcode && TOKEN_INVALID_ERRCODES.has(Number(result.errcode))) {
      await this.refreshAccessToken();
      result = await this.request<WeChatAPIResponse>(
        '/cgi-bin/message/custom/send',
        { method: 'POST', body: messageData },
      );
    }
    return result;
  }

  async uploadMedia(
    type: 'image' | 'voice' | 'video',
    body: unknown,
  ): Promise<string> {
    const data = await this.request<WeChatMediaUploadResult>(
      `/cgi-bin/media/upload?type=${type}`,
      { method: 'POST', body },
    );
    if (data.media_id) return data.media_id;
    throw new Error(`WeChat media upload failed: ${data.errcode ?? 'unknown'} ${data.errmsg ?? ''}`.trim());
  }

  async getFollowerIds(): Promise<readonly string[]> {
    const followers: string[] = [];
    let nextOpenid = '';
    do {
      const data = await this.request<WeChatAPIResponse & {
        count?: number;
        data?: { openid?: string[] };
        next_openid?: string;
      }>(`/cgi-bin/user/get?next_openid=${encodeURIComponent(nextOpenid)}`);
      if (data.errcode && data.errcode !== 0) {
        throw new Error(`WeChat API error: ${data.errcode} - ${data.errmsg}`);
      }
      followers.push(...(data.data?.openid ?? []).filter(Boolean));
      if (Number(data.count ?? 0) < 10_000) break;
      nextOpenid = data.next_openid ?? '';
    } while (nextOpenid);
    return Object.freeze(followers);
  }
}

export type WeChatMpClientEventMap = Record<string, unknown>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly 'wechat-mp': { readonly client: WeChatMpClient; readonly events: WeChatMpClientEventMap };
  }
}

export const wechatMpClient = defineEndpointClient<WeChatMpClient, WeChatMpClientEventMap>('wechat-mp');
