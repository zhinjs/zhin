/**
 * Bilibili 直播 Web API client（非官方接口，Experimental）。
 * 读：房间号解析、弹幕服务器地址与 token（WBI 签名）；写：`msg/send` 发弹幕。
 * 永远不要记录 Cookie。
 */
import { createHash } from 'node:crypto';
import { BILIBILI_LIVE_RISK_CODES, type LiveDanmaku, type ResolvedBilibiliLiveConfig } from './protocol.js';

export type BilibiliLiveFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (zhin.js adapter-bilibili-live; experimental)';

/** 平台返回非 0 code。`risk` 为 true 时调用方必须熔断。 */
export class BilibiliLiveApiError extends Error {
  readonly risk: boolean;
  readonly code: number;
  readonly httpStatus?: number;
  constructor(code: number, message: string, httpStatus?: number) {
    super(message);
    this.name = 'BilibiliLiveApiError';
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
    this.risk = BILIBILI_LIVE_RISK_CODES.has(code) || httpStatus === 412;
  }
}

export interface DanmuServer {
  readonly url: string;
  readonly token: string;
}

export interface LiveRoomInfo {
  readonly roomId: string;
  readonly anchorUid?: string;
}

/** WBI 签名的 mixin 置换表（平台前端公开常量）。 */
const MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

/** 计算 WBI 签名后的查询串（追加 `wts` 与 `w_rid`）。 */
export function signWbi(params: Record<string, string | number>, imgKey: string, subKey: string, nowSec: number): string {
  const raw = imgKey + subKey;
  const mixin = MIXIN_KEY_TABLE.map((index) => raw[index] ?? '').join('').slice(0, 32);
  const entries = Object.entries({ ...params, wts: nowSec })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value).replace(/[!'()*]/g, ''))}`);
  const query = entries.join('&');
  const rid = createHash('md5').update(query + mixin).digest('hex');
  return `${query}&w_rid=${rid}`;
}

function keyFromUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  const name = url.slice(url.lastIndexOf('/') + 1);
  const dot = name.indexOf('.');
  return dot >= 0 ? name.slice(0, dot) : name;
}

export class BilibiliLiveClient {
  readonly config: ResolvedBilibiliLiveConfig;
  readonly fetch: BilibiliLiveFetch;
  readonly now: () => number;
  #buvid3?: string;
  #selfUid?: string;

  constructor(config: ResolvedBilibiliLiveConfig, fetch: BilibiliLiveFetch, now: () => number = Date.now, signal?: AbortSignal) {
    this.config = config;
    this.fetch = bindBilibiliLiveFetch(fetch, signal);
    this.now = now;
    this.#buvid3 = config.buvid3;
  }

  /** 是否具备发弹幕所需的 SESSDATA + bili_jct。 */
  get canWrite(): boolean {
    return Boolean(this.config.sessdata && this.config.biliJct);
  }

  /** 登录账号 uid（`nav` 成功后可用）。 */
  get selfUid(): string | undefined {
    return this.#selfUid;
  }

  /** Read-only identity probe; unlike live startup this creates no visitor ID or socket. */
  async identifySelf(): Promise<string | undefined> {
    if (!this.config.sessdata) return undefined;
    const data = await this.#request(`${this.config.apiBaseUrl}/x/web-interface/nav`) as { isLogin?: boolean; mid?: unknown };
    if (data?.isLogin === false) return undefined;
    if (data?.isLogin !== true || (typeof data.mid !== 'number' && typeof data.mid !== 'string')
      || !String(data.mid).trim() || data.mid === 0 || data.mid === '0') {
      throw new Error('Bilibili live returned an invalid logged-in identity');
    }
    return String(data.mid);
  }

  #cookie(): string {
    const parts: string[] = [];
    if (this.config.sessdata) parts.push(`SESSDATA=${this.config.sessdata}`);
    if (this.config.biliJct) parts.push(`bili_jct=${this.config.biliJct}`);
    if (this.#buvid3) parts.push(`buvid3=${this.#buvid3}`);
    return parts.join('; ');
  }

  async #request(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<unknown> {
    const cookie = this.#cookie();
    const response = await this.fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        'user-agent': USER_AGENT,
        referer: `https://live.bilibili.com/${this.config.roomId}`,
        origin: 'https://live.bilibili.com',
        ...(cookie ? { cookie } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new BilibiliLiveApiError(-1, `HTTP ${response.status}`, response.status);
    const envelope = await response.json() as { code?: unknown; message?: unknown; msg?: unknown; data?: unknown };
    const code = typeof envelope.code === 'number' ? envelope.code : Number(envelope.code ?? -1);
    if (code !== 0) {
      throw new BilibiliLiveApiError(code, String(envelope.message ?? envelope.msg ?? `code ${code}`));
    }
    return envelope.data;
  }

  /** 读取登录态与 WBI 密钥。未登录时 nav 返回 -101，但仍带 WBI 密钥。 */
  async #nav(): Promise<{ imgKey: string; subKey: string }> {
    const cookie = this.#cookie();
    const response = await this.fetch(`${this.config.apiBaseUrl}/x/web-interface/nav`, {
      headers: { 'user-agent': USER_AGENT, ...(cookie ? { cookie } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new BilibiliLiveApiError(-1, `HTTP ${response.status}`, response.status);
    const envelope = await response.json() as { code?: number; data?: { isLogin?: boolean; mid?: unknown; wbi_img?: { img_url?: unknown; sub_url?: unknown } } };
    const data = envelope.data;
    this.#selfUid = data?.isLogin && data.mid != null ? String(data.mid) : undefined;
    return { imgKey: keyFromUrl(data?.wbi_img?.img_url), subKey: keyFromUrl(data?.wbi_img?.sub_url) };
  }

  async #ensureBuvid(): Promise<void> {
    if (this.#buvid3) return;
    try {
      const data = await this.#request(`${this.config.apiBaseUrl}/x/frontend/finger/spi`) as { b_3?: unknown };
      if (typeof data?.b_3 === 'string' && data.b_3) this.#buvid3 = data.b_3;
    } catch {
      // 拿不到 buvid3 时继续：只是更容易被风控，由 getDanmuInfo 的错误码兜底。
    }
  }

  /** 短号 → 真实房间号。 */
  async resolveRoom(): Promise<LiveRoomInfo> {
    const data = await this.#request(
      `${this.config.liveApiBaseUrl}/room/v1/Room/room_init?id=${encodeURIComponent(this.config.roomId)}`,
    ) as { room_id?: unknown; uid?: unknown };
    const roomId = String(data?.room_id ?? '');
    if (!/^\d+$/.test(roomId)) throw new BilibiliLiveApiError(-1, 'room_init returned no room_id');
    return Object.freeze({ roomId, ...(data?.uid != null ? { anchorUid: String(data.uid) } : {}) });
  }

  /** 弹幕服务器与鉴权 token。 */
  async getDanmuServer(roomId: string): Promise<DanmuServer> {
    await this.#ensureBuvid();
    const { imgKey, subKey } = await this.#nav();
    const params = { id: roomId, type: 0, web_location: '444.8' };
    const query = imgKey && subKey
      ? signWbi(params, imgKey, subKey, Math.floor(this.now() / 1000))
      : new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const data = await this.#request(
      `${this.config.liveApiBaseUrl}/xlive/web-room/v1/index/getDanmuInfo?${query}`,
    ) as { token?: unknown; host_list?: { host?: unknown; wss_port?: unknown }[] };
    const token = typeof data?.token === 'string' ? data.token : '';
    const host = data?.host_list?.find((item) => typeof item.host === 'string' && item.host);
    const url = host
      ? `wss://${String(host.host)}:${Number(host.wss_port) || 443}/sub`
      : 'wss://broadcastlv.chat.bilibili.com/sub';
    return Object.freeze({ url, token });
  }

  /** 鉴权包正文。 */
  authBody(roomId: string, token: string): string {
    return JSON.stringify({
      uid: Number(this.#selfUid ?? 0),
      roomid: Number(roomId),
      protover: 3,
      platform: 'web',
      type: 2,
      key: token,
      ...(this.#buvid3 ? { buvid: this.#buvid3 } : {}),
    });
  }

  /** 发一条弹幕。`replyUid` 让平台把这条弹幕标成「回复」某位观众。 */
  async sendDanmaku(roomId: string, message: string, replyUid?: string): Promise<void> {
    if (!this.canWrite) throw new BilibiliLiveApiError(-101, 'sending danmaku requires SESSDATA and bili_jct');
    const csrf = this.config.biliJct!;
    const body = new URLSearchParams({
      bubble: '0',
      msg: message,
      color: '16777215',
      mode: '1',
      room_type: '0',
      jumpfrom: '0',
      reply_mid: replyUid ?? '0',
      reply_attr: '0',
      replay_dmid: '',
      statistics: JSON.stringify({ appId: 100, platform: 5 }),
      fontsize: '25',
      rnd: String(Math.floor(this.now() / 1000)),
      roomid: roomId,
      csrf,
      csrf_token: csrf,
    }).toString();
    await this.#request(`${this.config.liveApiBaseUrl}/msg/send`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }
}

/** 原生事件：`danmaku`（解析后的 `DANMU_MSG`）。 */
export type BilibiliLiveClientEventMap = Record<string, LiveDanmaku>;

/** Bind the actual account incarnation without changing existing request timeouts. */
function bindBilibiliLiveFetch(fetch: BilibiliLiveFetch, signal: AbortSignal | undefined): BilibiliLiveFetch {
  if (!signal) return fetch;
  return async (url, init) => {
    signal.throwIfAborted();
    const response = await fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    signal.throwIfAborted();
    return { ok: response.ok, status: response.status, async json() {
      const body = await response.json(); signal.throwIfAborted(); return body;
    } };
  };
}
