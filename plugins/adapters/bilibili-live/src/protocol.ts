/**
 * Bilibili 直播弹幕协议（Experimental，非官方 Web 接口）。
 *
 * - 一个直播间 = 一个 conversation：`{ kind: 'group', id: <真实房间号> }`
 * - 弹幕 WebSocket 包头 16 字节：包长 u32 / 头长 u16 / 协议版本 u16 / 操作码 u32 / 序号 u32（大端）
 * - 操作码：2 心跳、3 心跳回包（人气）、5 业务消息、7 认证、8 认证回包
 * - 协议版本：0 / 1 原文 JSON，2 zlib，3 brotli（内层仍是若干个包）
 */
import { brotliDecompressSync, inflateSync } from 'node:zlib';

export const LIVE_OP = Object.freeze({
  heartbeat: 2,
  heartbeatReply: 3,
  message: 5,
  auth: 7,
  authReply: 8,
});

const HEADER_LENGTH = 16;
/** 单个包的长度上限：超过视为坏包，丢弃整帧。 */
const MAX_PACKET_LENGTH = 4 * 1024 * 1024;
/** 嵌套压缩的深度上限（正常只有一层）。 */
const MAX_NESTING = 2;

/** 平台风控 / 频控类错误码：发送方立即熔断，不自动重试。 */
export const BILIBILI_LIVE_RISK_CODES: ReadonlySet<number> = new Set([-352, -412, -509, 10031]);

export type BilibiliLiveSendMode = 'direct' | 'off';

/** 普通用户弹幕长度上限（字符）；直播等级更高的账号可以调大。 */
export const BILIBILI_LIVE_DEFAULT_MAX_LENGTH = 20;
export const BILIBILI_LIVE_DEFAULT_MAX_CHUNKS = 2;
export const BILIBILI_LIVE_DEFAULT_SEND_INTERVAL_SEC = 5;
export const BILIBILI_LIVE_MIN_SEND_INTERVAL_SEC = 2;
export const BILIBILI_LIVE_HEARTBEAT_MS = 30_000;

/** One endpoint config after AdapterIndex expands `<instanceKey>.endpoints`. */
export interface BilibiliLiveEndpointConfig {
  readonly id: string;
  /** 直播间号（短号或长号都可以）。只填你自己的直播间。 */
  readonly roomId?: string | number;
  /** Cookie SESSDATA（请用 ${ENV} 注入，切勿写进仓库）。不填则匿名只读。 */
  readonly sessdata?: string;
  /** Cookie bili_jct（即 csrf token），发弹幕需要。 */
  readonly biliJct?: string;
  /** Cookie buvid3；不填时启动时向平台申请一个。 */
  readonly buvid3?: string;
  /** 出站模式：`direct`（默认，回合结束直接发弹幕）/ `off`（只听不说）。 */
  readonly sendMode?: BilibiliLiveSendMode;
  /** 单条弹幕最多字符数，默认 20。 */
  readonly maxLength?: number;
  /** 一次回复最多拆成几条弹幕，默认 2；放不下的截断。 */
  readonly maxChunks?: number;
  /** 两次回复的最小间隔秒数（默认 5，最小 2）；不足时拒绝发送，不排队。 */
  readonly minSendIntervalSec?: number;
  readonly apiBaseUrl?: string;
  readonly liveApiBaseUrl?: string;
}

export interface ResolvedBilibiliLiveConfig {
  readonly context: 'bilibili-live';
  readonly id: string;
  readonly roomId: string;
  readonly sessdata?: string;
  readonly biliJct?: string;
  readonly buvid3?: string;
  readonly sendMode: BilibiliLiveSendMode;
  readonly maxLength: number;
  readonly maxChunks: number;
  readonly minSendIntervalMs: number;
  readonly apiBaseUrl: string;
  readonly liveApiBaseUrl: string;
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function resolveBilibiliLiveConfig(raw: unknown): ResolvedBilibiliLiveConfig {
  const config = (raw && typeof raw === 'object' ? raw : {}) as BilibiliLiveEndpointConfig;
  const id = optionalString(config.id);
  if (!id) throw new Error('bilibili-live endpoint requires an id');
  const roomId = String(config.roomId ?? '').trim();
  if (!/^\d+$/.test(roomId) || roomId === '0') {
    throw new Error(`bilibili-live endpoint "${id}" requires a numeric roomId`);
  }
  const sessdata = optionalString(config.sessdata);
  const biliJct = optionalString(config.biliJct);
  const buvid3 = optionalString(config.buvid3);
  return Object.freeze({
    context: 'bilibili-live' as const,
    id,
    roomId,
    ...(sessdata ? { sessdata } : {}),
    ...(biliJct ? { biliJct } : {}),
    ...(buvid3 ? { buvid3 } : {}),
    sendMode: config.sendMode === 'off' ? 'off' : 'direct',
    maxLength: intInRange(config.maxLength, BILIBILI_LIVE_DEFAULT_MAX_LENGTH, 10, 100),
    maxChunks: intInRange(config.maxChunks, BILIBILI_LIVE_DEFAULT_MAX_CHUNKS, 1, 5),
    minSendIntervalMs: intInRange(
      config.minSendIntervalSec,
      BILIBILI_LIVE_DEFAULT_SEND_INTERVAL_SEC,
      BILIBILI_LIVE_MIN_SEND_INTERVAL_SEC,
      3600,
    ) * 1000,
    apiBaseUrl: trimTrailingSlashes(optionalString(config.apiBaseUrl) ?? 'https://api.bilibili.com'),
    liveApiBaseUrl: trimTrailingSlashes(optionalString(config.liveApiBaseUrl) ?? 'https://api.live.bilibili.com'),
  });
}

/** 去掉末尾的 `/`；逐字符扫描，避免 `/\/+$/` 在长串 `/` 上的多项式回溯。 */
function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}

/** 编码一个弹幕 WebSocket 包。 */
export function encodeLivePacket(op: number, body: string | Uint8Array = ''): Buffer {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  const packet = Buffer.alloc(HEADER_LENGTH + payload.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt16BE(HEADER_LENGTH, 4);
  packet.writeUInt16BE(1, 6);
  packet.writeUInt32BE(op, 8);
  packet.writeUInt32BE(1, 12);
  payload.copy(packet, HEADER_LENGTH);
  return packet;
}

export type LivePacket =
  | { readonly op: 3; readonly popularity: number }
  | { readonly op: 5; readonly body: unknown }
  | { readonly op: 8; readonly body: unknown };

/**
 * 解码一帧（可能含多个包、可能压缩）。坏包整帧丢弃，不抛错：
 * 平台改版时宁可漏几条弹幕，也不让连接崩溃重连刷屏。
 */
export function decodeLiveFrame(frame: Uint8Array, depth = 0): LivePacket[] {
  const buffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  const packets: LivePacket[] = [];
  let offset = 0;
  while (offset + HEADER_LENGTH <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const headerLength = buffer.readUInt16BE(offset + 4);
    const version = buffer.readUInt16BE(offset + 6);
    const op = buffer.readUInt32BE(offset + 8);
    if (length < headerLength || headerLength < HEADER_LENGTH || length > MAX_PACKET_LENGTH || offset + length > buffer.length) {
      return [];
    }
    const body = buffer.subarray(offset + headerLength, offset + length);
    offset += length;
    try {
      if (op === LIVE_OP.heartbeatReply) {
        packets.push({ op: 3, popularity: body.length >= 4 ? body.readUInt32BE(0) : 0 });
      } else if (op === LIVE_OP.message && (version === 2 || version === 3)) {
        if (depth >= MAX_NESTING) continue;
        const inner = version === 2 ? inflateSync(body) : brotliDecompressSync(body);
        packets.push(...decodeLiveFrame(inner, depth + 1));
      } else if (op === LIVE_OP.message || op === LIVE_OP.authReply) {
        packets.push({ op, body: JSON.parse(body.toString('utf8')) as unknown });
      }
    } catch {
      // 单个包解析失败：跳过这个包。
    }
  }
  return packets;
}

/** 一条直播弹幕（`DANMU_MSG`）。 */
export interface LiveDanmaku {
  /** 平台弹幕 id；旧格式没有时为空。 */
  readonly id?: string;
  readonly text: string;
  /** 发送者 uid；未登录收弹幕时平台给 0。 */
  readonly uid: string;
  readonly uname: string;
  readonly timestamp: number;
}

/** 从业务消息里取出弹幕；不是 `DANMU_MSG` 或格式不认识时返回 undefined。 */
export function parseDanmaku(body: unknown): LiveDanmaku | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const message = body as { cmd?: unknown; info?: unknown };
  if (typeof message.cmd !== 'string' || !message.cmd.startsWith('DANMU_MSG')) return undefined;
  if (!Array.isArray(message.info)) return undefined;
  const [meta, text, user] = message.info as [unknown, unknown, unknown];
  if (typeof text !== 'string' || !text.trim() || !Array.isArray(user)) return undefined;
  const uid = String(user[0] ?? '0');
  const uname = typeof user[1] === 'string' ? user[1] : uid;
  const metaList = Array.isArray(meta) ? meta : [];
  const timestamp = typeof metaList[4] === 'number' ? metaList[4] : Date.now();
  const id = danmakuId(metaList[15]);
  return Object.freeze({ ...(id ? { id } : {}), text: text.trim(), uid, uname, timestamp });
}

function danmakuId(extraHolder: unknown): string | undefined {
  if (!extraHolder || typeof extraHolder !== 'object') return undefined;
  const extra = (extraHolder as { extra?: unknown }).extra;
  if (typeof extra !== 'string') return undefined;
  try {
    const parsed = JSON.parse(extra) as { id_str?: unknown };
    return typeof parsed.id_str === 'string' && parsed.id_str ? parsed.id_str : undefined;
  } catch {
    return undefined;
  }
}

interface WireSegment {
  readonly type?: string;
  readonly data?: Record<string, unknown>;
}

/** 出站：弹幕只支持纯文本；mention 不进正文，返回被 @ 者 uid 交给平台的「回复」字段。 */
export function formatOutboundDanmaku(payload: unknown): { readonly text: string; readonly replyUid?: string } {
  if (typeof payload === 'string') return { text: payload.replace(/\s+/g, ' ').trim() };
  if (payload == null) return { text: '' };
  const items = Array.isArray(payload) ? payload : [payload];
  let replyUid: string | undefined;
  const text = items.map((item) => {
    if (typeof item === 'string') return item;
    const seg = item as WireSegment;
    if (seg.type === 'text') return String(seg.data?.text ?? '');
    if (seg.type === 'mention' || seg.type === 'at') {
      const id = String(seg.data?.id ?? seg.data?.user_id ?? '').trim();
      if (!replyUid && /^[1-9]\d*$/.test(id)) {
        replyUid = id;
        return '';
      }
      return `@${String(seg.data?.name ?? id)} `;
    }
    return '';
  }).join('').replace(/\s+/g, ' ').trim();
  return { text, ...(replyUid ? { replyUid } : {}) };
}

/**
 * 把回复切成至多 `maxChunks` 条弹幕，每条至多 `maxLength` 字符（按码点算）。
 * 放不下的部分截掉，最后一条以「…」结尾。
 */
export function splitDanmaku(text: string, maxLength: number, maxChunks: number): string[] {
  const chars = [...text.trim()];
  if (chars.length === 0) return [];
  const chunks: string[] = [];
  for (let start = 0; start < chars.length && chunks.length < maxChunks; start += maxLength) {
    chunks.push(chars.slice(start, start + maxLength).join(''));
  }
  if (chars.length > maxLength * maxChunks) {
    const last = [...chunks[chunks.length - 1]!];
    chunks[chunks.length - 1] = `${last.slice(0, maxLength - 1).join('')}…`;
  }
  return chunks;
}
