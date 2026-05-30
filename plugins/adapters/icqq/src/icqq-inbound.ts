/**
 * icqq 守护进程 IPC 入站事件归一化（post_type / message_type / message 段）
 */
import type { MessageSegment } from "zhin.js";
import { parseCqMessage } from "./cq-message.js";

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
  const ext = data as IcqqIpcMessageEvent & Record<string, unknown>;
  const messageId = ext.message_id ?? ext.messageId;
  if (messageId != null && String(messageId) !== "") {
    return { id: String(messageId), source: "message_id" };
  }
  if (ext.msg_id != null && String(ext.msg_id) !== "") {
    return { id: String(ext.msg_id), source: "msg_id" };
  }
  if (ext.seq != null && String(ext.seq) !== "") {
    return { id: String(ext.seq), source: "seq" };
  }
  const uid =
    resolveIcqqInboundUserId(ext as Record<string, unknown>) ?? 0;
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
      case "reply":
        out.push({ type: "reply", data: { id: String(el.id ?? "") } });
        break;
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

export function resolveInboundContent(
  data: IcqqIpcMessageEvent,
): MessageSegment[] {
  const fromElements = icqqElementsToSegments(data.message);
  if (fromElements?.length) return fromElements;
  const raw = data.raw_message ?? "";
  if (raw) return parseCqMessage(raw);
  return [{ type: "text", data: { text: "" } }];
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
