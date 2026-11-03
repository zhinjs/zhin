import type { EndpointProfileConfiguration } from 'zhin.js/adapter';
/**
 * 抖音直播弹幕协议（Experimental，非官方 Web 协议）。
 *
 * - 一个直播间 = 一个 conversation：`{ kind: 'channel', id: <web_rid> }`（与配置 `roomId` 一致）；
 *   平台内部 room_id 放在 `metadata.roomId`。
 * - WebSocket 帧是 protobuf `PushFrame`；`payload` 通常 gzip 压缩，内层是 `Response`，
 *   `Response.messagesList` 里每条 `Message` 按 `method` 区分类型。本包只解 `WebcastChatMessage`（聊天弹幕）。
 * - 只维护最小 proto：帧外壳 + ChatMessage 用到的字段，手写解码，不引第三方 protobuf 运行时。
 */
import { gunzipSync } from 'node:zlib';

export type DouyinLiveSendMode = 'direct' | 'off';

export const DOUYIN_LIVE_DEFAULT_MAX_LENGTH = 50;
export const DOUYIN_LIVE_DEFAULT_MAX_CHUNKS = 2;
export const DOUYIN_LIVE_DEFAULT_SEND_INTERVAL_SEC = 5;
export const DOUYIN_LIVE_MIN_SEND_INTERVAL_SEC = 2;
/** 心跳间隔：网页端约 10 秒一次 `hb` 帧。 */
export const DOUYIN_LIVE_HEARTBEAT_MS = 10_000;
/** 唯一解析的消息类型。 */
export const DOUYIN_CHAT_METHOD = 'WebcastChatMessage';

/** 单帧 / 解压后的大小上限：超过视为坏帧，整帧丢弃。 */
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/** One endpoint config after AdapterIndex expands `<instanceKey>.endpoints`. */
export interface DouyinLiveEndpointConfig extends EndpointProfileConfiguration {
  readonly id: string;
  /** 直播间 web_rid（`https://live.douyin.com/<web_rid>` 里的数字）。只填你自己的直播间。 */
  readonly roomId?: string | number;
  /** 浏览器 Cookie 整串（请用 ${DOUYIN_LIVE_COOKIE} 注入，切勿写进仓库）。不填时启动时向平台申请游客 `ttwid`。 */
  readonly cookie?: string;
  /** 出站模式：`off`（默认，只听不说）/ `direct`（尚未实现，发送返回 `not_implemented`）。 */
  readonly sendMode?: DouyinLiveSendMode;
  /** 单条弹幕最多字符数，默认 50（为后续 direct 发送预留）。 */
  readonly maxLength?: number;
  /** 一次回复最多拆成几条弹幕，默认 2。 */
  readonly maxChunks?: number;
  /** 两次回复的最小间隔秒数（默认 5，最小 2）。 */
  readonly minSendIntervalSec?: number;
  /**
   * 可选：外部签名服务地址。WebSocket 的 `signature` 参数由平台混淆脚本生成，本包不内置；
   * 配置后以 `GET <signerUrl>?stub=<X-MS-STUB>` 取签名（返回纯文本或 `{ signature }`）。
   */
  readonly signerUrl?: string;
}

export interface ResolvedDouyinLiveConfig {
  readonly context: 'douyin-live';
  readonly id: string;
  /** web_rid。 */
  readonly roomId: string;
  readonly cookie?: string;
  readonly sendMode: DouyinLiveSendMode;
  readonly maxLength: number;
  readonly maxChunks: number;
  readonly minSendIntervalMs: number;
  readonly signerUrl?: string;
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function resolveDouyinLiveConfig(raw: unknown): ResolvedDouyinLiveConfig {
  const config = (raw && typeof raw === 'object' ? raw : {}) as DouyinLiveEndpointConfig;
  const id = optionalString(config.id);
  if (!id) throw new Error('douyin-live endpoint requires an id');
  const roomId = String(config.roomId ?? '').trim();
  if (!/^[1-9]\d*$/.test(roomId)) {
    throw new Error(`douyin-live endpoint "${id}" requires a numeric roomId (web_rid)`);
  }
  const cookie = optionalString(config.cookie);
  const signerUrl = optionalString(config.signerUrl);
  if (signerUrl && !/^https?:\/\//i.test(signerUrl)) {
    throw new Error(`douyin-live endpoint "${id}" signerUrl must be an http(s) URL`);
  }
  return Object.freeze({
    context: 'douyin-live' as const,
    id,
    roomId,
    ...(cookie ? { cookie } : {}),
    // α：默认只听不说；只有显式写 direct 才进入（尚未实现的）发送路径。
    sendMode: config.sendMode === 'direct' ? 'direct' : 'off',
    maxLength: intInRange(config.maxLength, DOUYIN_LIVE_DEFAULT_MAX_LENGTH, 10, 100),
    maxChunks: intInRange(config.maxChunks, DOUYIN_LIVE_DEFAULT_MAX_CHUNKS, 1, 5),
    minSendIntervalMs: intInRange(
      config.minSendIntervalSec,
      DOUYIN_LIVE_DEFAULT_SEND_INTERVAL_SEC,
      DOUYIN_LIVE_MIN_SEND_INTERVAL_SEC,
      3600,
    ) * 1000,
    ...(signerUrl ? { signerUrl } : {}),
  });
}

// ---------------------------------------------------------------------------
// 最小 protobuf 编解码
// ---------------------------------------------------------------------------

type ProtoValue = bigint | Uint8Array;
interface ProtoField { readonly field: number; readonly value: ProtoValue }

/** 解出一层 message 的所有字段（varint / fixed / length-delimited）。格式错误抛错。 */
export function readProtoFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (pos >= bytes.length) throw new Error('truncated varint');
      const byte = bytes[pos++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new Error('varint too long');
  };
  while (pos < bytes.length) {
    const key = varint();
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field <= 0) throw new Error('invalid field number');
    if (wire === 0) {
      fields.push({ field, value: varint() });
    } else if (wire === 2) {
      const length = Number(varint());
      if (length < 0 || pos + length > bytes.length) throw new Error('truncated bytes');
      fields.push({ field, value: bytes.subarray(pos, pos + length) });
      pos += length;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (pos + size > bytes.length) throw new Error('truncated fixed');
      let value = 0n;
      for (let i = size - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[pos + i]!);
      fields.push({ field, value });
      pos += size;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return fields;
}

const utf8 = new TextDecoder('utf-8');
const first = (fields: readonly ProtoField[], field: number) => fields.find((item) => item.field === field)?.value;
const asBytes = (value: ProtoValue | undefined) => (value instanceof Uint8Array ? value : undefined);
const asString = (value: ProtoValue | undefined) => (value instanceof Uint8Array ? utf8.decode(value) : '');
const asUint = (value: ProtoValue | undefined) => (typeof value === 'bigint' ? value : 0n);

function writeVarint(out: number[], value: bigint): void {
  let v = BigInt.asUintN(64, value);
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
}

function writeBytesField(out: number[], field: number, bytes: Uint8Array): void {
  writeVarint(out, BigInt((field << 3) | 2));
  writeVarint(out, BigInt(bytes.length));
  for (const byte of bytes) out.push(byte);
}

// ---------------------------------------------------------------------------
// PushFrame / Response / Message / ChatMessage
// ---------------------------------------------------------------------------

/** `PushFrame`（WebSocket 外层帧）。字段号：seqId 1 / logId 2 / payloadEncoding 6 / payloadType 7 / payload 8。 */
export interface PushFrame {
  readonly seqId: string;
  readonly logId: string;
  readonly payloadEncoding: string;
  readonly payloadType: string;
  readonly payload: Uint8Array;
}

export function decodePushFrame(bytes: Uint8Array): PushFrame | undefined {
  if (bytes.byteLength > MAX_FRAME_BYTES) return undefined;
  try {
    const fields = readProtoFields(bytes);
    return Object.freeze({
      seqId: asUint(first(fields, 1)).toString(),
      logId: asUint(first(fields, 2)).toString(),
      payloadEncoding: asString(first(fields, 6)),
      payloadType: asString(first(fields, 7)),
      payload: asBytes(first(fields, 8)) ?? new Uint8Array(),
    });
  } catch {
    return undefined;
  }
}

export function encodePushFrame(frame: { readonly logId?: string; readonly payloadType: string; readonly payloadEncoding?: string; readonly payload?: Uint8Array }): Uint8Array {
  const out: number[] = [];
  if (frame.logId && frame.logId !== '0') {
    writeVarint(out, 2n << 3n);
    writeVarint(out, BigInt(frame.logId));
  }
  if (frame.payloadEncoding) writeBytesField(out, 6, Buffer.from(frame.payloadEncoding, 'utf8'));
  writeBytesField(out, 7, Buffer.from(frame.payloadType, 'utf8'));
  if (frame.payload && frame.payload.length > 0) writeBytesField(out, 8, frame.payload);
  return Uint8Array.from(out);
}

/** 心跳帧：`PushFrame { payloadType: 'hb' }`。 */
export function encodeHeartbeat(): Uint8Array {
  return encodePushFrame({ payloadType: 'hb' });
}

/** 确认帧：`Response.needAck` 时回 `PushFrame { logId, payloadType: 'ack', payload: internalExt }`。 */
export function encodeAck(logId: string, internalExt: string): Uint8Array {
  return encodePushFrame({ logId, payloadType: 'ack', payload: Buffer.from(internalExt, 'utf8') });
}

/** `Message`：method 1 / payload 2 / msgId 3。 */
export interface WebcastMessage {
  readonly method: string;
  readonly payload: Uint8Array;
  readonly msgId: string;
}

/** `Response`：messagesList 1 / internalExt 5 / heartbeatDuration 8 / needAck 9。 */
export interface WebcastResponse {
  readonly messages: readonly WebcastMessage[];
  readonly internalExt: string;
  readonly needAck: boolean;
  readonly heartbeatDurationMs: number;
}

/**
 * 解一帧：PushFrame → （gzip）→ Response。不是消息帧（如心跳回包）或坏帧返回 undefined，不抛错：
 * 平台改版时宁可漏几条弹幕，也不让连接崩溃重连刷屏。
 */
export function decodeWebcastFrame(bytes: Uint8Array): { readonly frame: PushFrame; readonly response?: WebcastResponse } | undefined {
  const frame = decodePushFrame(bytes);
  if (!frame) return undefined;
  if (frame.payloadType && frame.payloadType !== 'msg') return { frame };
  if (frame.payload.length === 0) return { frame };
  try {
    const gzipped = frame.payloadEncoding === 'gzip' || (frame.payload[0] === 0x1f && frame.payload[1] === 0x8b);
    const raw = gzipped ? gunzipSync(frame.payload, { maxOutputLength: MAX_FRAME_BYTES }) : frame.payload;
    const fields = readProtoFields(raw);
    const messages: WebcastMessage[] = [];
    for (const item of fields) {
      if (item.field !== 1 || !(item.value instanceof Uint8Array)) continue;
      try {
        const msg = readProtoFields(item.value);
        messages.push(Object.freeze({
          method: asString(first(msg, 1)),
          payload: asBytes(first(msg, 2)) ?? new Uint8Array(),
          msgId: asUint(first(msg, 3)).toString(),
        }));
      } catch {
        // 单条坏消息：跳过。
      }
    }
    return {
      frame,
      response: Object.freeze({
        messages: Object.freeze(messages),
        internalExt: asString(first(fields, 5)),
        heartbeatDurationMs: Number(asUint(first(fields, 8))),
        needAck: asUint(first(fields, 9)) !== 0n,
      }),
    };
  } catch {
    return { frame };
  }
}

/** 一条抖音直播聊天弹幕（`WebcastChatMessage`）。 */
export interface DouyinLiveChat {
  /** 平台消息 id（`common.msgId`，或外层 `Message.msgId`）；取不到时为空。 */
  readonly id?: string;
  readonly text: string;
  /** 发送者 user id；取不到时为 `'0'`。 */
  readonly uid: string;
  readonly nickname: string;
  /** 平台内部 room_id（`common.roomId`），取不到时为空。 */
  readonly roomId?: string;
  /** 毫秒时间戳。 */
  readonly timestamp: number;
}

/**
 * 解 `ChatMessage`：common 1（method 1 / msgId 2 / roomId 3 / createTime 4）、
 * user 2（id 1 / nickName 3 / idStr 1028）、content 3、eventTime 15。
 */
export function parseChatMessage(message: WebcastMessage, now: () => number = Date.now): DouyinLiveChat | undefined {
  if (message.method !== DOUYIN_CHAT_METHOD) return undefined;
  try {
    const chat = readProtoFields(message.payload);
    const text = asString(first(chat, 3)).trim();
    if (!text) return undefined;
    const commonBytes = asBytes(first(chat, 1));
    const common = commonBytes ? readProtoFields(commonBytes) : [];
    const userBytes = asBytes(first(chat, 2));
    const user = userBytes ? readProtoFields(userBytes) : [];
    const idStr = asString(first(user, 1028)).trim();
    const numericId = asUint(first(user, 1));
    const uid = /^\d+$/.test(idStr) && !/^0+$/.test(idStr) ? idStr : numericId.toString();
    const nickname = asString(first(user, 3)).trim() || uid;
    const commonMsgId = asUint(first(common, 2));
    const msgId = commonMsgId !== 0n ? commonMsgId.toString() : message.msgId !== '0' ? message.msgId : undefined;
    const roomId = asUint(first(common, 3));
    const createTime = Number(asUint(first(common, 4)));
    const eventTime = Number(asUint(first(chat, 15)));
    const raw = createTime > 0 ? createTime : eventTime;
    // createTime 为毫秒，eventTime 为秒；按量级区分。
    const timestamp = raw <= 0 ? now() : raw < 1e12 ? raw * 1000 : raw;
    return Object.freeze({
      ...(msgId ? { id: msgId } : {}),
      text,
      uid,
      nickname,
      ...(roomId !== 0n ? { roomId: roomId.toString() } : {}),
      timestamp,
    });
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 出站格式（为后续 direct 发送预留；当前 direct 返回 not_implemented）
// ---------------------------------------------------------------------------

interface WireSegment {
  readonly type?: string;
  readonly data?: Record<string, unknown>;
}

/** 出站：弹幕只支持纯文本；抖音弹幕没有「回复」字段，mention 折叠进正文 ` @昵称 `（前后留空格，避免与相邻文本粘连）。 */
export function formatOutboundDanmaku(payload: unknown): string {
  if (typeof payload === 'string') return payload.replace(/\s+/g, ' ').trim();
  if (payload == null) return '';
  const items = Array.isArray(payload) ? payload : [payload];
  return items.map((item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    const seg = item as WireSegment;
    if (seg.type === 'text') return String(seg.data?.text ?? '');
    if (seg.type === 'mention' || seg.type === 'at') {
      const name = String(seg.data?.name ?? seg.data?.id ?? seg.data?.user_id ?? '').trim();
      return name ? ` @${name} ` : '';
    }
    return '';
  }).join('').replace(/\s+/g, ' ').trim();
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
