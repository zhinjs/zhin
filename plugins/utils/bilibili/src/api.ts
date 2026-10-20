/**
 * Minimal Bilibili web API client.
 *
 * Only public, key-less endpoints are used. Every response is validated
 * defensively: when Bilibili changes a payload we raise a `BiliApiError` with
 * kind `shape` instead of crashing the poller, and risk-control responses
 * (-352 / -412 / -799 / HTTP 412) are reported as kind `risk` so callers can
 * back off.
 */
import { mixinKey, signWbi, wbiKeyFromUrl } from './wbi.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export type BiliErrorKind = 'risk' | 'not_found' | 'http' | 'shape' | 'network';

export class BiliApiError extends Error {
  readonly kind: BiliErrorKind;
  readonly code: number | undefined;
  constructor(kind: BiliErrorKind, message: string, code?: number) {
    super(message);
    this.name = 'BiliApiError';
    this.kind = kind;
    this.code = code;
  }
}

const RISK_CODES = new Set([-352, -412, -509, -799, -401]);
const NOT_FOUND_CODES = new Set([-404, -626, 4100000, 60004, 1]);
const WBI_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Browser fingerprint hints the web client sends with the space feed. Without
 * them anonymous requests are answered with -352 far more often.
 */
const DM_PARAMS: Readonly<Record<string, string>> = Object.freeze({
  dm_img_list: '[]',
  dm_img_str: Buffer.from('WebGL 1.0 (OpenGL ES 2.0 Chromium)').toString('base64').replace(/=+$/u, ''),
  dm_cover_img_str: Buffer.from('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)Google Inc. (Apple)')
    .toString('base64')
    .replace(/=+$/u, ''),
});

export interface LiveInfo {
  readonly uid: string;
  readonly uname: string;
  readonly roomId: string;
  readonly title: string;
  /** 0 = offline, 1 = live, 2 = replay carousel. */
  readonly liveStatus: number;
  /** Unix seconds of the current live start, 0 when unknown. */
  readonly liveTime: number;
  readonly cover: string;
  readonly area: string;
  readonly url: string;
}

export interface RoomInfo {
  readonly uid: string;
  readonly roomId: string;
  readonly title: string;
  readonly liveStatus: number;
  readonly area: string;
  readonly online: number;
  readonly url: string;
}

export interface DynamicItem {
  readonly id: string;
  readonly author: string;
  /** Unix seconds. */
  readonly pubTs: number;
  readonly type: string;
  readonly pinned: boolean;
  readonly summary: string;
  readonly url: string;
}

export interface UserCard {
  readonly uid: string;
  readonly name: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BiliClientOptions {
  readonly timeout?: number;
  readonly cookie?: string;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function int(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function clip(text: string, max = 120): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function absoluteUrl(url: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

export class BiliClient {
  readonly #timeout: number;
  readonly #userCookie: string;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  #buvid: string | undefined;
  #wbi: { key: string; at: number } | undefined;

  constructor(options: BiliClientOptions = {}) {
    this.#timeout = options.timeout ?? 10_000;
    this.#userCookie = options.cookie?.trim() ?? '';
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
  }

  /** Forget cached device id and WBI key, e.g. after a risk-control response. */
  resetSession(): void {
    this.#buvid = undefined;
    this.#wbi = undefined;
  }

  async #request(url: string, init: RequestInit & { cookie?: boolean; referer?: string; acceptCodes?: readonly number[] } = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      referer: init.referer ?? 'https://www.bilibili.com/',
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.cookie !== false) {
      const cookie = await this.#cookie();
      if (cookie) headers.cookie = cookie;
    }
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: init.method ?? 'GET',
        headers,
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: AbortSignal.timeout(this.#timeout),
      });
    } catch (error) {
      const cause = error as Error;
      throw new BiliApiError('network', cause.name === 'TimeoutError' ? `请求超时（${this.#timeout}ms）` : `请求失败: ${cause.message}`);
    }
    if (response.status === 412) throw new BiliApiError('risk', 'B 站风控拦截（HTTP 412）', 412);
    if (!response.ok) throw new BiliApiError('http', `HTTP ${response.status}`, response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new BiliApiError('shape', '接口返回的不是 JSON');
    }
    if (!isRecord(body)) throw new BiliApiError('shape', '接口返回格式异常');
    const code = int(body.code);
    if (code !== 0 && !init.acceptCodes?.includes(code)) {
      const message = str(body.message) || str(body.msg) || `错误码 ${code}`;
      if (RISK_CODES.has(code)) {
        this.resetSession();
        throw new BiliApiError('risk', `B 站风控拦截（${code}: ${message}）`, code);
      }
      if (NOT_FOUND_CODES.has(code)) throw new BiliApiError('not_found', message, code);
      throw new BiliApiError('http', message, code);
    }
    return body.data;
  }

  async #cookie(): Promise<string> {
    if (this.#userCookie) return this.#userCookie;
    if (this.#buvid !== undefined) return this.#buvid;
    try {
      const data = await this.#request('https://api.bilibili.com/x/frontend/finger/spi', { cookie: false });
      const b3 = isRecord(data) ? str(data.b_3) : '';
      const b4 = isRecord(data) ? str(data.b_4) : '';
      this.#buvid = b3 ? `buvid3=${b3}${b4 ? `; buvid4=${encodeURIComponent(b4)}` : ''}` : '';
    } catch {
      // Device id is best effort; most endpoints still answer without it.
      this.#buvid = '';
    }
    return this.#buvid;
  }

  async #wbiKey(): Promise<string> {
    if (this.#wbi && this.#now() - this.#wbi.at < WBI_TTL_MS) return this.#wbi.key;
    // `nav` answers -101 (not logged in) for guests but still carries wbi_img.
    const data = await this.#request('https://api.bilibili.com/x/web-interface/nav', { acceptCodes: [-101] });
    const img = isRecord(data) && isRecord(data.wbi_img) ? data.wbi_img : undefined;
    const imgUrl = img ? str(img.img_url) : '';
    const subUrl = img ? str(img.sub_url) : '';
    if (!imgUrl || !subUrl) throw new BiliApiError('shape', '无法获取 WBI 密钥');
    const key = mixinKey(wbiKeyFromUrl(imgUrl), wbiKeyFromUrl(subUrl));
    this.#wbi = { key, at: this.#now() };
    return key;
  }

  /** Batch live status by UP uid (no auth). */
  async getLiveStatus(uids: readonly string[]): Promise<Map<string, LiveInfo>> {
    const result = new Map<string, LiveInfo>();
    for (let index = 0; index < uids.length; index += 50) {
      const chunk = uids.slice(index, index + 50).map(Number);
      const data = await this.#request('https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uids: chunk }),
        referer: 'https://live.bilibili.com/',
      });
      // An empty result is serialised as [] instead of {}.
      if (Array.isArray(data)) continue;
      if (!isRecord(data)) throw new BiliApiError('shape', '开播状态接口格式异常');
      for (const [key, value] of Object.entries(data)) {
        if (!isRecord(value)) continue;
        const uid = str(value.uid) || key;
        const roomId = str(value.room_id);
        result.set(uid, {
          uid,
          uname: str(value.uname),
          roomId,
          title: str(value.title),
          liveStatus: int(value.live_status),
          liveTime: int(value.live_time),
          cover: str(value.cover_from_user) || str(value.keyframe),
          area: str(value.area_v2_name) || str(value.area_name),
          url: roomId ? `https://live.bilibili.com/${roomId}` : '',
        });
      }
    }
    return result;
  }

  async getRoomInfo(roomId: string): Promise<RoomInfo> {
    const data = await this.#request(
      `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(roomId)}`,
      { referer: 'https://live.bilibili.com/' },
    );
    if (!isRecord(data) || !str(data.room_id)) throw new BiliApiError('shape', '直播间接口格式异常');
    const realId = str(data.room_id);
    return {
      uid: str(data.uid),
      roomId: realId,
      title: str(data.title),
      liveStatus: int(data.live_status),
      area: str(data.area_name),
      online: int(data.online),
      url: `https://live.bilibili.com/${realId}`,
    };
  }

  async getUserCard(uid: string): Promise<UserCard> {
    const data = await this.#request(`https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(uid)}`);
    const card = isRecord(data) && isRecord(data.card) ? data.card : undefined;
    if (!card) throw new BiliApiError('shape', '用户信息接口格式异常');
    return { uid: str(card.mid) || uid, name: str(card.name) };
  }

  /** Latest space dynamics of one UP (WBI signed). Newest first, as returned. */
  async getDynamics(uid: string): Promise<DynamicItem[]> {
    const key = await this.#wbiKey();
    const query = signWbi({ host_mid: uid, features: 'itemOpusStyle', ...DM_PARAMS }, key, Math.floor(this.#now() / 1000));
    const data = await this.#request(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?${query}`, {
      referer: `https://space.bilibili.com/${uid}/dynamic`,
      headers: { origin: 'https://space.bilibili.com' },
    });
    if (!isRecord(data) || !Array.isArray(data.items)) throw new BiliApiError('shape', '动态接口格式异常');
    const items: DynamicItem[] = [];
    for (const raw of data.items) {
      const item = parseDynamic(raw);
      if (item) items.push(item);
    }
    return items;
  }
}

/** Turn one raw feed item into a compact, push-ready record (undefined = skip). */
export function parseDynamic(raw: unknown): DynamicItem | undefined {
  if (!isRecord(raw)) return undefined;
  const id = str(raw.id_str);
  if (!id) return undefined;
  const type = str(raw.type);
  // Live rooms are pushed by the live watcher, not as dynamics.
  if (type === 'DYNAMIC_TYPE_LIVE_RCMD' || type === 'DYNAMIC_TYPE_LIVE') return undefined;
  const modules = isRecord(raw.modules) ? raw.modules : {};
  const author = isRecord(modules.module_author) ? modules.module_author : {};
  const dynamic = isRecord(modules.module_dynamic) ? modules.module_dynamic : {};
  const tag = isRecord(modules.module_tag) ? modules.module_tag : {};
  const major = isRecord(dynamic.major) ? dynamic.major : {};
  const desc = isRecord(dynamic.desc) ? str(dynamic.desc.text) : '';
  const archive = isRecord(major.archive) ? major.archive : undefined;
  const opus = isRecord(major.opus) ? major.opus : undefined;
  const article = isRecord(major.article) ? major.article : undefined;
  const opusText = opus && isRecord(opus.summary) ? str(opus.summary.text) : '';
  const opusTitle = opus ? str(opus.title) : '';

  let summary: string;
  let url = `https://t.bilibili.com/${id}`;
  switch (type) {
    case 'DYNAMIC_TYPE_AV':
      summary = `投稿了视频：${archive ? str(archive.title) : desc}`;
      if (archive && str(archive.jump_url)) url = absoluteUrl(str(archive.jump_url));
      break;
    case 'DYNAMIC_TYPE_ARTICLE':
      summary = `发布了专栏：${opusTitle || (article ? str(article.title) : '') || clip(opusText)}`;
      break;
    case 'DYNAMIC_TYPE_FORWARD':
      summary = `转发了动态：${clip(desc) || '(无附言)'}`;
      break;
    default:
      summary = clip(opusText || desc || opusTitle) || '发布了新动态';
  }
  return {
    id,
    author: str(author.name),
    pubTs: int(author.pub_ts),
    type,
    pinned: str(tag.text) === '置顶',
    summary,
    url,
  };
}

/** Accepts `123`, `UID:123`, `https://space.bilibili.com/123/...`. */
export function parseUid(input: string): string | undefined {
  const text = input.trim();
  const fromUrl = /space\.bilibili\.com\/(\d{1,20})/u.exec(text);
  if (fromUrl) return fromUrl[1];
  const plain = /^(?:uid[:：]?)?(\d{1,20})$/iu.exec(text);
  return plain?.[1];
}

/** Accepts `21452505` or `https://live.bilibili.com/21452505`. */
export function parseRoomId(input: string): string | undefined {
  const text = input.trim();
  const fromUrl = /live\.bilibili\.com\/(?:h5\/)?(\d{1,20})/u.exec(text);
  if (fromUrl) return fromUrl[1];
  return /^\d{1,20}$/u.test(text) ? text : undefined;
}
