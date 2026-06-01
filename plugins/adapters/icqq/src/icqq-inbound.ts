/**
 * icqq 守护进程 IPC 入站事件归一化（post_type / message_type / message 段）
 */
import { Message, type MessageSegment, type QuotedMessagePayload } from "zhin.js";
import { parseCqMessage } from "./cq-message.js";
import { extractForwardResidFromJsonElement } from "./forward-msg.js";

/** 守护进程推送的通用事件壳 */
export interface IcqqIpcEventBase {
  post_type?: string;
  self_id?: number;
}

/** post_type=message 时的消息体（字段随 icqqjs/cli 演进，未知字段保留） */
export interface IcqqIpcMessageEvent extends IcqqIpcEventBase {
  post_type: "message";
  message_id?: string;
  msg_id?: string;
  user_id: number;
  user_uid?: string;
  time: number;
  seq?: number;
  message_type: string;
  sub_type?: string;
  raw_message?: string;
  message?: IcqqMessageElement[];
  sender?: {
    user_id?: number;
    user_uid?: string;
    nickname?: string;
    card?: string;
  };
  from_id?: number;
  from_uid?: string;
  group_id?: number;
  to_id?: number;
  nickname?: string;
  /** 旧版 IPC 仅有 type 无 message_type */
  type?: "group" | "private";
  /** oicq Message#source：被引用回复的源消息 */
  source?: IcqqMessageSource;
}

/** oicq 引用源消息（与 MessageEvent.source 对齐） */
export interface IcqqMessageSource {
  message_id?: string;
  msg_id?: string;
  seq?: number;
  rand?: number;
  time?: number;
  user_id?: number;
  group_id?: number;
  raw_message?: string;
  /** 元素数组，或 NT 推送的纯文本摘要 */
  message?: IcqqMessageElement[] | string;
  sender?: {
    user_id?: number;
    nickname?: string;
    card?: string;
  };
  [key: string]: unknown;
}

export type IcqqMessageElement = {
  type: string;
  text?: string;
  qq?: string | number;
  user_id?: string | number;
  id?: string | number;
  url?: string;
  file?: string;
  [key: string]: unknown;
};

/** 归一化后供适配器使用的入站消息 */
export interface NormalizedIcqqInbound {
  messageId: string;
  idSource: "message_id" | "msg_id" | "seq" | "synthetic";
  channelType: "group" | "private";
  channelId: string;
  userId: string;
  nickname: string;
  content: MessageSegment[];
  rawMessage: string;
  timestampMs: number;
  raw: IcqqIpcMessageEvent;
}

const DEDUPE_TTL_MS = 120_000;

const MESSAGE_POST_TYPES = new Set(["message"]);

function isMessagePostType(postType: unknown): boolean {
  if (typeof postType !== "string" || postType === "") return false;
  if (MESSAGE_POST_TYPES.has(postType)) return true;
  // 如 message.private / message.group
  return postType.startsWith("message.");
}

/** 从 IPC 事件壳中取出 OneBot/icqq 载荷（兼容 data 嵌套或字段在根级） */
export function unwrapIcqqIpcEventPayload(event: {
  data?: unknown;
  [key: string]: unknown;
}): unknown {
  const nested = event.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const d = nested as Record<string, unknown>;
    if (isRecognizedIcqqIpcPayload(d)) {
      return nested;
    }
    for (const key of ["data", "detail", "payload", "event"]) {
      const inner = d[key];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner;
      }
    }
  }

  const { id: _id, event: _ev, data: _data, ok: _ok, ...rest } = event;
  if (isRecognizedIcqqIpcPayload(rest)) {
    return rest;
  }
  return nested;
}

function isRecognizedIcqqIpcPayload(d: Record<string, unknown>): boolean {
  const pt = d.post_type;
  if (typeof pt === "string") {
    if (
      isMessagePostType(pt) ||
      pt === "notice" ||
      pt === "request" ||
      pt === "meta_event" ||
      pt.startsWith("notice.") ||
      pt.startsWith("request.") ||
      pt.startsWith("system.")
    ) {
      return true;
    }
  }
  return (
    d.message_type != null ||
    d.raw_message != null ||
    d.message != null ||
    d.type === "group" ||
    d.type === "private" ||
    d.notice_type != null ||
    d.request_type != null ||
    d.meta_event_type != null
  );
}

export function resolveIcqqInboundUserId(
  data: Record<string, unknown>,
): number | undefined {
  const sender = data.sender;
  if (sender && typeof sender === "object" && !Array.isArray(sender)) {
    const suid = (sender as { user_id?: unknown }).user_id;
    if (suid != null) return Number(suid);
  }
  if (data.user_id != null) return Number(data.user_id);
  if (data.from_id != null) return Number(data.from_id);
  return undefined;
}

export function isIcqqMessagePostType(
  data: unknown,
): data is IcqqIpcMessageEvent {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (isMessagePostType(d.post_type)) return true;
  // 其它 post_type（notice/request 等）明确排除
  if (d.post_type != null && d.post_type !== "") return false;
  const hasBody =
    typeof d.raw_message === "string" ||
    Array.isArray(d.message) ||
    typeof d.message_type === "string" ||
    d.type === "group" ||
    d.type === "private";
  return hasBody && resolveIcqqInboundUserId(d) != null;
}

export function shouldSkipSelfInboundMessage(
  data: IcqqIpcMessageEvent,
): boolean {
  if (data.self_id == null || data.user_id == null) return false;
  return Number(data.self_id) === Number(data.user_id);
}

export function resolveChannelFromIcqqMessage(
  data: IcqqIpcMessageEvent,
): { channelType: "group" | "private"; channelId: string } {
  const messageType =
    data.message_type ??
    (data.type === "group" || data.type === "private" ? data.type : undefined);

  if (messageType === "group" || data.group_id != null) {
    return {
      channelType: "group",
      channelId: String(data.group_id ?? data.from_id ?? data.user_id),
    };
  }
  return {
    channelType: "private",
    channelId: String(data.from_id ?? data.user_id),
  };
}

export function resolveIcqqInboundMessageId(
  data: IcqqIpcMessageEvent,
  channelId: string,
): { id: string; source: "message_id" | "msg_id" | "seq" | "synthetic" } {
  if (data.message_id != null && String(data.message_id) !== "") {
    return { id: String(data.message_id), source: "message_id" };
  }
  if (data.msg_id != null && String(data.msg_id) !== "") {
    return { id: String(data.msg_id), source: "msg_id" };
  }
  if (data.seq != null && String(data.seq) !== "") {
    return { id: String(data.seq), source: "seq" };
  }
  const uid =
    resolveIcqqInboundUserId(data as unknown as Record<string, unknown>) ?? 0;
  return {
    id: `${data.time}_${uid}_${channelId}`,
    source: "synthetic",
  };
}

export function icqqElementsToSegments(
  elements: IcqqMessageElement[] | undefined,
): MessageSegment[] | null {
  if (!elements?.length) return null;
  const out: MessageSegment[] = [];

  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const type = el.type;
    switch (type) {
      case "text":
        if (el.text != null && el.text !== "") {
          out.push({ type: "text", data: { text: String(el.text) } });
        }
        break;
      case "at":
        out.push({
          type: "at",
          data: { qq: String(el.qq ?? el.user_id ?? "") },
        });
        break;
      case "face":
        out.push({ type: "face", data: { id: Number(el.id) } });
        break;
      case "image":
        out.push({
          type: "image",
          data: {
            url: String(el.url ?? el.file ?? ""),
            file: String(el.file ?? el.url ?? ""),
          },
        });
        break;
      case "forward": {
        const forwardResid = String(
          el.id ?? el.resid ?? el.res_id ?? el.file ?? "",
        ).trim();
        if (forwardResid) {
          out.push({
            type: "forward",
            data: { id: forwardResid, resid: forwardResid },
          });
        } else {
          out.push({ type: "text", data: { text: "[聊天记录]" } });
        }
        break;
      }
      case "light_app":
      case "xml": {
        const forwardResid = extractForwardResidFromJsonElement(el);
        if (forwardResid) {
          out.push({
            type: "forward",
            data: { id: forwardResid, resid: forwardResid },
          });
        } else if (el.text != null && el.text !== "") {
          out.push({ type: "text", data: { text: String(el.text) } });
        } else {
          out.push({ type: "text", data: { text: "[聊天记录]" } });
        }
        break;
      }
      case "reply": {
        const replyId = String(el.id ?? el.message_id ?? "");
        if (replyId) {
          out.push({
            type: "reply",
            data: { id: replyId, message_id: replyId },
          });
        }
        break;
      }
      case "json": {
        const forwardResid = extractForwardResidFromJsonElement(el);
        if (forwardResid) {
          out.push({
            type: "forward",
            data: { id: forwardResid, resid: forwardResid },
          });
          break;
        }
        const replyFromJson = resolveReplyIdFromJsonElement(el);
        if (replyFromJson) {
          out.push({
            type: "reply",
            data: { id: replyFromJson, message_id: replyFromJson },
          });
        } else if (el.text != null && el.text !== "") {
          out.push({ type: "text", data: { text: String(el.text) } });
        }
        break;
      }
      case "record":
      case "audio":
        out.push({
          type: "record",
          data: { file: String(el.file ?? el.url ?? "") },
        });
        break;
      case "video":
        out.push({
          type: "video",
          data: { file: String(el.file ?? el.url ?? "") },
        });
        break;
      default:
        if (el.text != null && el.text !== "") {
          out.push({ type: "text", data: { text: String(el.text) } });
        }
        break;
    }
  }
  return out.length ? out : null;
}

function resolveReplyIdFromJsonElement(el: IcqqMessageElement): string | undefined {
  let payload: unknown = el.data ?? el;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const refer =
    record.msgRefer ??
    record.reply ??
    record.resid ??
    record.message_id ??
    record.id;
  if (refer && typeof refer === "object") {
    const r = refer as Record<string, unknown>;
    const id = r.msgId ?? r.message_id ?? r.id ?? r.msg_id;
    if (id != null && String(id)) return String(id);
  }
  if (typeof refer === "string" && refer) return refer;
  if (typeof refer === "number") return String(refer);
  return undefined;
}

const MAX_SOURCE_WALK_DEPTH = 10;

function icqqSourceMessageBody(s: IcqqMessageSource): unknown {
  return (s as Record<string, unknown>).message;
}

function icqqSourceHasBody(s: IcqqMessageSource): boolean {
  const body = icqqSourceMessageBody(s);
  if (Array.isArray(body) && body.length > 0) return true;
  if (typeof body === "string" && body.trim().length > 0) return true;
  return typeof s.raw_message === "string" && s.raw_message.length > 0;
}

function looksLikeIcqqMessageSource(value: unknown): value is IcqqMessageSource {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  // 整条入站事件也有 message_id，不能与 oicq Message#source 混淆
  if (r.post_type != null || r.message_type != null) return false;
  const s = value as IcqqMessageSource;
  if (!icqqSourceHasBody(s)) return false;
  return !!resolveQuoteIdFromIcqqSource(value);
}

/** IPC 载荷可能把 source 嵌在 data / event 等字段，深度查找 */
export function findIcqqNestedMessageSource(
  root: unknown,
  maxDepth = MAX_SOURCE_WALK_DEPTH,
): IcqqMessageSource | undefined {
  const seen = new Set<unknown>();
  function walk(node: unknown, depth: number): IcqqMessageSource | undefined {
    if (depth > maxDepth || node == null) return undefined;
    if (typeof node !== "object") return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);

    if (looksLikeIcqqMessageSource(node)) {
      return node as IcqqMessageSource;
    }

    const record = node as Record<string, unknown>;
    if (record.source && looksLikeIcqqMessageSource(record.source)) {
      return record.source as IcqqMessageSource;
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        const hit = walk(value, depth + 1);
        if (hit) return hit;
      }
    }
    return undefined;
  }
  return walk(root, 0);
}

/** 从 oicq MessageEvent.source 解析被引用消息的 message_id */
export function resolveQuoteIdFromIcqqSource(
  source: unknown,
): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const s = source as IcqqMessageSource;
  if (s.message_id != null && String(s.message_id).trim()) {
    return String(s.message_id).trim();
  }
  if (s.msg_id != null && String(s.msg_id).trim()) {
    return String(s.msg_id).trim();
  }
  // NT 引用源常仅有 seq/rand，无 message_id
  if (s.seq != null && String(s.seq) !== "") {
    const seq = String(s.seq);
    if (s.rand != null && String(s.rand) !== "") {
      return `${seq}:${s.rand}`;
    }
    return seq;
  }
  return undefined;
}

function icqqSourceToContentSegments(
  s: IcqqMessageSource,
): MessageSegment[] {
  const body = icqqSourceMessageBody(s);
  if (Array.isArray(body) && body.length) {
    return icqqElementsToSegments(body as IcqqMessageElement[]) ?? [];
  }
  if (typeof body === "string" && body.trim()) {
    return [{ type: "text", data: { text: body.trim() } }];
  }
  if (typeof s.raw_message === "string" && s.raw_message) {
    return parseCqMessage(s.raw_message);
  }
  return [];
}

/** 将 source 转为 QuotedMessagePayload（供 $getMsg 缓存，避免重复拉取） */
export function quotedPayloadFromIcqqSource(
  source: unknown,
): QuotedMessagePayload | null {
  if (!source || typeof source !== "object") return null;
  const s = source as IcqqMessageSource;
  const body = icqqSourceMessageBody(s);
  const content = icqqSourceToContentSegments(s);
  const messageId = resolveQuoteIdFromIcqqSource(source);
  if (!messageId && !content.length) return null;
  const senderRaw = s.sender;
  const senderFromUserId =
    s.user_id != null
      ? { id: String(s.user_id), name: "" }
      : undefined;
  return {
    messageId: messageId ?? `seq:${s.seq ?? 0}:${s.rand ?? 0}`,
    sender: senderRaw
      ? {
          id: String(senderRaw.user_id ?? ""),
          name: String(senderRaw.nickname ?? senderRaw.card ?? ""),
        }
      : senderFromUserId,
    content,
    raw:
      typeof s.raw_message === "string"
        ? s.raw_message
        : typeof body === "string"
          ? body
          : undefined,
    time: typeof s.time === "number" ? s.time : undefined,
  };
}

/** 从 IPC 事件顶层字段解析引用 message_id（与 message 段互补） */
export function resolveIcqqQuoteIdFromEvent(
  data: IcqqIpcMessageEvent,
): string | undefined {
  const fromSource =
    resolveQuoteIdFromIcqqSource(data.source) ??
    resolveQuoteIdFromIcqqSource(findIcqqNestedMessageSource(data));
  if (fromSource) return fromSource;

  const ext = data as IcqqIpcMessageEvent & Record<string, unknown>;
  const candidates = [
    ext.reply,
    ext.quoted_message_id,
    ext.quote_message_id,
    ext.source_message_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number") return String(c);
    if (c && typeof c === "object") {
      const r = c as Record<string, unknown>;
      const id = r.id ?? r.message_id ?? r.msg_id ?? r.msgId;
      if (id != null && String(id)) return String(id);
    }
  }
  return undefined;
}

function mergeReplyFromRawMessage(
  content: MessageSegment[],
  rawMessage: string,
): MessageSegment[] {
  if (!rawMessage || Message.quoteIdFromContent(content)) return content;
  const fromRaw = parseCqMessage(rawMessage);
  const quoteFromRaw = Message.quoteIdFromContent(fromRaw);
  if (!quoteFromRaw) return content;
  return [
    { type: "reply", data: { id: quoteFromRaw, message_id: quoteFromRaw } },
    ...content.filter((s) => s.type !== "reply"),
  ];
}

function mergeReplyFromSource(
  content: MessageSegment[],
  data: IcqqIpcMessageEvent,
): MessageSegment[] {
  if (Message.quoteIdFromContent(content)) return content;
  const quoteId =
    resolveQuoteIdFromIcqqSource(data.source) ??
    resolveQuoteIdFromIcqqSource(findIcqqNestedMessageSource(data));
  if (!quoteId) return content;
  return [
    { type: "reply", data: { id: quoteId, message_id: quoteId } },
    ...content.filter((s) => s.type !== "reply"),
  ];
}

export function resolveInboundContent(
  data: IcqqIpcMessageEvent,
): MessageSegment[] {
  const fromElements = icqqElementsToSegments(data.message);
  const raw = data.raw_message ?? "";
  let content: MessageSegment[];
  if (fromElements?.length) {
    content = mergeReplyFromRawMessage(fromElements, raw);
  } else if (raw) {
    content = parseCqMessage(raw);
  } else {
    content = [{ type: "text", data: { text: "" } }];
  }
  return mergeReplyFromSource(content, data);
}

export function normalizeIcqqInboundMessage(
  data: IcqqIpcMessageEvent,
): NormalizedIcqqInbound | null {
  if (!isIcqqMessagePostType(data)) return null;
  const ext = data as IcqqIpcMessageEvent & Record<string, unknown>;
  const userIdNum = resolveIcqqInboundUserId(ext);
  if (userIdNum == null) return null;
  const { channelType, channelId } = resolveChannelFromIcqqMessage(data);
  const resolved = resolveIcqqInboundMessageId(data, channelId);
  const nickname =
    data.sender?.nickname ?? data.nickname ?? String(userIdNum);
  const rawMessage = data.raw_message ?? "";
  return {
    messageId: resolved.id,
    idSource: resolved.source,
    channelType,
    channelId,
    userId: String(userIdNum),
    nickname,
    content: resolveInboundContent(data),
    rawMessage,
    timestampMs: data.time * 1000,
    raw: data,
  };
}

/** 按 message_id 去重（多路 subscribe 会收到同一消息多次） */
export class InboundMessageDeduper {
  private readonly seen = new Map<string, number>();

  shouldProcess(messageId: string): boolean {
    const now = Date.now();
    for (const [id, t] of this.seen) {
      if (now - t > DEDUPE_TTL_MS) this.seen.delete(id);
    }
    if (this.seen.has(messageId)) return false;
    this.seen.set(messageId, now);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}
