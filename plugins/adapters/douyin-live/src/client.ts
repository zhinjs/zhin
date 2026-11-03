/**
 * 抖音直播 Web 侧 client（非官方协议，Experimental）。
 * 读：游客 `ttwid`、直播间页 → 内部 room_id、弹幕 WebSocket 地址（含可选 signature）。
 * 本包不做发弹幕（sendMode α），也不内置平台混淆签名脚本。永远不要记录 Cookie。
 */
import { createHash, randomInt } from 'node:crypto';
import type { DouyinLiveChat, ResolvedDouyinLiveConfig } from './protocol.js';

export type DouyinLiveFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null; getSetCookie?(): string[] };
  text(): Promise<string>;
}>;

/**
 * 由 `X-MS-STUB`（参数串 md5）算出 WebSocket `signature`。
 * 返回空串 / 缺失视为签名失败并抛错（不会静默降级为无签名）；想无签名连接就不要配置 signer。
 * `signal` 带 15 s 请求超时与客户端取消。
 */
export type DouyinLiveSigner = (stub: string, signal?: AbortSignal) => Promise<string> | string;

export interface DouyinLiveRoomInfo {
  /** 平台内部 room_id（WebSocket 用）。 */
  readonly roomId: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const LIVE_BASE_URL = 'https://live.douyin.com';
export const DOUYIN_LIVE_PUSH_URL = 'wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/';
/** 平台会拒绝明显的非浏览器 UA；与 `browser_version` 参数保持一致。 */
export const DOUYIN_LIVE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
/** `X-MS-STUB` 参与 md5 的参数（顺序固定，取自网页端 SDK）。 */
const STUB_KEYS = [
  'live_id', 'aid', 'version_code', 'webcast_sdk_version', 'room_id', 'sub_room_id', 'sub_channel_id',
  'did_rule', 'user_unique_id', 'device_platform', 'device_type', 'ac', 'identity',
] as const;
const MAX_SIGNATURE_LENGTH = 512;

export class DouyinLiveApiError extends Error {
  readonly httpStatus?: number;
  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = 'DouyinLiveApiError';
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

/**
 * `X-MS-STUB` = md5(`k1=v1,k2=v2,...`)，按 `STUB_KEYS` 顺序取 WebSocket 查询参数。
 * md5 是平台协议规定的参数摘要（不是安全用途）；输入只有公开参数与随机游客设备 id，不含 Cookie 或账号凭据。
 */
export function buildSignatureStub(params: ReadonlyMap<string, string> | Record<string, string>): string {
  const get = (key: string) => (params instanceof Map ? params.get(key) : (params as Record<string, string>)[key]) ?? '';
  const plain = STUB_KEYS.map((key) => `${key}=${get(key)}`).join(',');
  return createHash('md5').update(plain).digest('hex');
}

function cookieValue(cookie: string | undefined, name: string): string | undefined {
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      if (value) return value;
    }
  }
  return undefined;
}

function randomDigits(length: number): string {
  let out = String(randomInt(1, 10));
  while (out.length < length) out += String(randomInt(0, 10));
  return out;
}

function randomHex(length: number): string {
  let out = '';
  while (out.length < length) out += randomInt(0, 16).toString(16);
  return out;
}

export class DouyinLiveClient {
  readonly config: ResolvedDouyinLiveConfig;
  readonly fetch: DouyinLiveFetch;
  readonly now: () => number;
  readonly #signer?: DouyinLiveSigner;
  readonly #signal?: AbortSignal;
  #ttwid?: string;
  /** 游客设备 id：同一 endpoint 生命周期内固定。 */
  readonly userUniqueId: string;

  constructor(
    config: ResolvedDouyinLiveConfig,
    fetch: DouyinLiveFetch,
    options: { readonly now?: () => number; readonly signal?: AbortSignal; readonly sign?: DouyinLiveSigner; readonly userUniqueId?: string } = {},
  ) {
    this.config = config;
    this.fetch = fetch;
    this.now = options.now ?? Date.now;
    this.#signal = options.signal;
    this.#signer = options.sign;
    this.#ttwid = cookieValue(config.cookie, 'ttwid');
    this.userUniqueId = options.userUniqueId ?? randomDigits(19);
  }

  /** 是否已有 `ttwid`（配置 Cookie 自带或已申请到游客 ttwid）。 */
  get hasTtwid(): boolean {
    return Boolean(this.#ttwid);
  }

  /** 是否能生成 WebSocket `signature`。 */
  get canSign(): boolean {
    return Boolean(this.#signer || this.config.signerUrl);
  }

  /** 连接 / 请求用的 Cookie：配置 Cookie 原样保留，缺 `ttwid` 时补上游客 ttwid。 */
  cookieHeader(extra: Record<string, string> = {}): string {
    const parts: string[] = [];
    if (this.config.cookie) parts.push(this.config.cookie.replace(/;\s*$/, ''));
    if (this.#ttwid && !cookieValue(this.config.cookie, 'ttwid')) parts.push(`ttwid=${this.#ttwid}`);
    for (const [key, value] of Object.entries(extra)) {
      if (!cookieValue(this.config.cookie, key)) parts.push(`${key}=${value}`);
    }
    return parts.join('; ');
  }

  #requestSignal(): AbortSignal {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return this.#signal ? AbortSignal.any([this.#signal, timeout]) : timeout;
  }

  async #get(url: string, headers: Record<string, string> = {}): Promise<Awaited<ReturnType<DouyinLiveFetch>>> {
    this.#signal?.throwIfAborted();
    const response = await this.fetch(url, {
      method: 'GET',
      headers: { 'user-agent': DOUYIN_LIVE_USER_AGENT, ...headers },
      signal: this.#requestSignal(),
    });
    this.#signal?.throwIfAborted();
    if (!response.ok) throw new DouyinLiveApiError(`HTTP ${response.status}`, response.status);
    return response;
  }

  /** 没有 `ttwid` 时访问直播首页申请游客 ttwid（平台经 Set-Cookie 下发）。 */
  async ensureTtwid(): Promise<void> {
    if (this.#ttwid) return;
    const response = await this.#get(`${LIVE_BASE_URL}/`);
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
    for (const line of cookies) {
      const match = /(?:^|[;,]\s*)ttwid=([^;,\s]+)/.exec(line);
      if (match?.[1]) {
        this.#ttwid = match[1];
        return;
      }
    }
    throw new DouyinLiveApiError('Douyin live did not issue a ttwid cookie');
  }

  /** web_rid → 内部 room_id：解析直播间页内嵌数据。每次（重）连都重新取。 */
  async resolveRoom(): Promise<DouyinLiveRoomInfo> {
    await this.ensureTtwid();
    const response = await this.#get(`${LIVE_BASE_URL}/${encodeURIComponent(this.config.roomId)}`, {
      cookie: this.cookieHeader({ __ac_nonce: `0${randomHex(20)}` }),
      referer: `${LIVE_BASE_URL}/`,
    });
    const html = await response.text();
    const roomId = parseRoomIdFromHtml(html);
    if (!roomId) throw new DouyinLiveApiError('Douyin live page returned no room_id (room offline or page changed)');
    return Object.freeze({ roomId });
  }

  /** 弹幕 WebSocket 查询参数（不含 signature）。 */
  pushParams(roomId: string): Map<string, string> {
    const nowMs = Math.floor(this.now());
    // 随机游客设备 id（非账号身份、非秘密）；平台把它同时用作 did 与 user_unique_id。
    const deviceId = this.userUniqueId;
    return new Map([
      ['app_name', 'douyin_web'], ['version_code', '180800'], ['webcast_sdk_version', '1.0.14-beta.0'],
      ['update_version_code', '1.0.14-beta.0'], ['compress', 'gzip'], ['device_platform', 'web'],
      ['cookie_enabled', 'true'], ['screen_width', '1536'], ['screen_height', '864'],
      ['browser_language', 'zh-CN'], ['browser_platform', 'Win32'], ['browser_name', 'Mozilla'],
      ['browser_version', DOUYIN_LIVE_USER_AGENT.slice('Mozilla/'.length)], ['browser_online', 'true'],
      ['tz_name', 'Asia/Shanghai'], ['cursor', `d-1_u-1_fh-0_t-${nowMs}_r-1`],
      ['internal_ext', `internal_src:dim|wss_push_room_id:${roomId}|wss_push_did:${deviceId}|first_req_ms:${nowMs}|fetch_time:${nowMs}|seq:1|wss_info:0-${nowMs}-0-0`],
      ['host', LIVE_BASE_URL], ['aid', '6383'], ['live_id', '1'], ['did_rule', '3'], ['endpoint', 'live_pc'],
      ['support_wrds', '1'], ['user_unique_id', deviceId], ['im_path', '/webcast/im/fetch/'], ['identity', 'audience'],
      ['need_persist_msg_count', '15'], ['insert_task_id', ''], ['live_reason', ''], ['room_id', roomId],
      ['heartbeatDuration', '0'],
    ]);
  }

  /** 弹幕 WebSocket 地址；能签名时追加 `signature`，否则不带（平台可能拒绝握手）。 */
  async buildPushUrl(roomId: string): Promise<string> {
    const params = this.pushParams(roomId);
    const signature = await this.signature(buildSignatureStub(params));
    if (signature) params.set('signature', signature);
    const query = [...params].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    return `${DOUYIN_LIVE_PUSH_URL}?${query}`;
  }

  /**
   * 取签名：优先注入的 signer，其次 `signerUrl`；都没有返回空串（unsigned）。
   * 配了签名来源却拿不到可用签名时抛错（可见、可重试），不静默降级成无签名连接。
   */
  async signature(stub: string): Promise<string> {
    let value: string;
    if (this.#signer) {
      const signal = this.#requestSignal();
      signal.throwIfAborted();
      value = await withAbort(Promise.resolve().then(() => this.#signer!(stub, signal)), signal);
    } else if (this.config.signerUrl) {
      const separator = this.config.signerUrl.includes('?') ? '&' : '?';
      const response = await this.#get(`${this.config.signerUrl}${separator}stub=${encodeURIComponent(stub)}`);
      value = parseSignerResponse(await response.text());
    } else {
      return '';
    }
    value = String(value ?? '').trim();
    if (!value) throw new DouyinLiveApiError('Douyin live signer returned an empty signature');
    if (value.length > MAX_SIGNATURE_LENGTH || /[\s&#]/.test(value)) {
      throw new DouyinLiveApiError('Douyin live signer returned an invalid signature');
    }
    return value;
  }
}

/** 让不理会 signal 的注入 signer 也受请求超时 / 取消约束。 */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  // 超时 / 取消后 signer 仍可能 reject：始终挂上处理器，避免 unhandled rejection。
  promise.catch(() => undefined);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/** 直播间页内嵌 JSON（转义或未转义）里的 `roomId`。 */
export function parseRoomIdFromHtml(html: string): string | undefined {
  const patterns = [/roomId\\":\\"(\d+)\\"/, /"roomId":"(\d+)"/];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1] && !/^0+$/.test(match[1])) return match[1];
  }
  return undefined;
}

function parseSignerResponse(body: string): string {
  const text = body.trim();
  if (!text.startsWith('{')) return text;
  try {
    const json = JSON.parse(text) as { signature?: unknown; 'X-Bogus'?: unknown; data?: { signature?: unknown } };
    const value = json.signature ?? json['X-Bogus'] ?? json.data?.signature;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/** 原生事件：`danmaku`（解析后的 `WebcastChatMessage`）。 */
export type DouyinLiveClientEventMap = Record<string, DouyinLiveChat>;
