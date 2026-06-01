/**
 * 合并转发（聊天记录）解析：从 json/xml 提取 resid，经 IPC get_forward_msg 拉取正文。
 */
import type { MessageSegment, QuotedMessagePayload } from "zhin.js";
import { segment } from "zhin.js";
import { Actions } from "./protocol.js";
import type { IpcClient } from "./ipc-client.js";
import {
  icqqElementsToSegments,
  type IcqqMessageElement,
} from "./icqq-inbound.js";
import { parseCqMessage } from "./cq-message.js";

const RESID_IN_XML_RE =
  /(?:m_resid|resid|fileid|res_id)=["']?([A-Za-z0-9+/=_.-]{8,})/i;

const FORWARD_PLACEHOLDER_RE =
  /\[聊天记录\]|合并转发|转发消息|聊天记录/i;

function parseJsonPayload(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

/** 从 QQ 合并转发 json 元素提取 resid */
export function extractForwardResidFromJsonElement(
  el: IcqqMessageElement,
): string | undefined {
  const record =
    parseJsonPayload(el.data) ??
    parseJsonPayload(el.text) ??
    parseJsonPayload(el);
  if (!record) {
    const text = typeof el.text === "string" ? el.text : "";
    const m = text.match(RESID_IN_XML_RE);
    return m?.[1]?.trim();
  }

  const bytes = record.bytesData ?? record.bytes_data ?? record.bytes;
  if (typeof bytes === "string" && bytes.trim()) {
    const inner = parseJsonPayload(bytes);
    if (inner) {
      const nested = extractForwardResidFromJsonElement({
        type: "json",
        data: inner,
      });
      if (nested) return nested;
    }
    const m = bytes.match(RESID_IN_XML_RE);
    if (m?.[1]) return m[1].trim();
  }

  const app = String(record.app ?? record.App ?? "");
  if (app.includes("multimsg") || app.includes("MultiMsg")) {
    const meta = record.meta as Record<string, unknown> | undefined;
    const detail = meta?.detail as Record<string, unknown> | undefined;
    const resid = detail?.resid ?? detail?.ResID ?? detail?.resId;
    if (resid != null && String(resid).trim()) return String(resid).trim();
  }

  const prompt = record.prompt as string | undefined;
  if (prompt) {
    const m = prompt.match(RESID_IN_XML_RE);
    if (m?.[1]) return m[1].trim();
  }

  const direct = record.resid ?? record.m_resid ?? record.fileid;
  if (direct != null && String(direct).trim()) return String(direct).trim();

  return undefined;
}

/** 从 get_msg 的 raw_message 解析 multimsg resid（XML / JSON / CQ:json） */
export function extractForwardResidFromRawMessage(
  raw: string,
): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  const xml = text.match(RESID_IN_XML_RE);
  if (xml?.[1]) return xml[1].trim();

  const asJson = parseJsonPayload(text);
  if (asJson) {
    const fromJson = extractForwardResidFromJsonElement({
      type: "json",
      data: asJson,
    });
    if (fromJson) return fromJson;
  }

  for (const match of text.matchAll(/\[CQ:json(?:,([^\]]*))?\]/gi)) {
    const arg = match[1] ?? "";
    const dataMatch = arg.match(/(?:^|,)data=(.+)$/s);
    if (!dataMatch?.[1]) continue;
    const record = parseJsonPayload(dataMatch[1].trim());
    if (!record) continue;
    const fromCq = extractForwardResidFromJsonElement({
      type: "json",
      data: record,
    });
    if (fromCq) return fromCq;
  }

  const segs = parseCqMessage(text);
  return extractForwardResidFromSegments(segs);
}

/** 从 get_msg 的 message 元素数组解析 multimsg resid */
export function extractForwardResidFromGetMsgElements(
  elements: IcqqMessageElement[] | undefined,
): string | undefined {
  if (!elements?.length) return undefined;
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    if (el.type === "forward") {
      const id = String(el.id ?? el.resid ?? el.res_id ?? el.file ?? "").trim();
      if (id) return id;
    }
    const fromJson = extractForwardResidFromJsonElement(el);
    if (fromJson) return fromJson;
  }
  const segs = icqqElementsToSegments(elements);
  if (segs?.length) {
    return extractForwardResidFromSegments(segs);
  }
  return extractForwardResidDeep(elements);
}

/**
 * 从 get_msg 响应解析合并转发 resid（优先 message 数组，其次 raw_message）。
 */
export function extractForwardResidFromGetMsg(
  data: unknown,
): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;

  if (Array.isArray(record.message)) {
    const fromElements = extractForwardResidFromGetMsgElements(
      record.message as IcqqMessageElement[],
    );
    if (fromElements) return fromElements;
  }

  if (typeof record.raw_message === "string" && record.raw_message.trim()) {
    const fromRaw = extractForwardResidFromRawMessage(record.raw_message);
    if (fromRaw) return fromRaw;
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return extractForwardResidFromRawMessage(record.message);
  }

  return undefined;
}

export function extractForwardResidFromSegments(
  content: MessageSegment[],
): string | undefined {
  for (const seg of content) {
    if (seg.type === "forward") {
      const id = seg.data?.id ?? seg.data?.resid;
      if (id != null && String(id).trim()) return String(id).trim();
    }
    if (seg.type === "json" && seg.data) {
      const resid = extractForwardResidFromJsonElement(
        seg.data as IcqqMessageElement,
      );
      if (resid) return resid;
      const raw = seg.data.data ?? seg.data.text;
      const record = parseJsonPayload(raw);
      if (record) {
        const fromEl = extractForwardResidFromJsonElement({
          type: "json",
          data: record,
        });
        if (fromEl) return fromEl;
      }
    }
  }
  const raw = segment.raw(content);
  const m = raw.match(RESID_IN_XML_RE);
  return m?.[1]?.trim();
}

export function extractForwardResidFromPayload(
  payload: QuotedMessagePayload,
): string | undefined {
  if (Array.isArray(payload.content)) {
    const fromSeg = extractForwardResidFromSegments(
      payload.content as MessageSegment[],
    );
    if (fromSeg) return fromSeg;
  }
  if (typeof payload.raw === "string") {
    const m = payload.raw.match(RESID_IN_XML_RE);
    if (m?.[1]) return m[1].trim();
    const record = parseJsonPayload(payload.raw);
    if (record) {
      return extractForwardResidFromJsonElement({ type: "json", data: record });
    }
  }
  return undefined;
}

/** 在 get_msg / IPC 原始对象里深度搜索 resid */
export function extractForwardResidDeep(
  root: unknown,
  maxDepth = 14,
): string | undefined {
  const seen = new Set<unknown>();
  function walk(node: unknown, depth: number): string | undefined {
    if (depth > maxDepth || node == null) return undefined;
    if (typeof node === "string") {
      const m = node.match(RESID_IN_XML_RE);
      if (m?.[1]) return m[1].trim();
      const record = parseJsonPayload(node);
      if (record) {
        const fromJson = extractForwardResidFromJsonElement({
          type: "json",
          data: record,
        });
        if (fromJson) return fromJson;
      }
      return undefined;
    }
    if (typeof node !== "object") return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walk(item, depth + 1);
        if (hit) return hit;
      }
      return undefined;
    }

    const fromEl = extractForwardResidFromJsonElement({
      type: "json",
      data: node as IcqqMessageElement,
    });
    if (fromEl) return fromEl;

    for (const value of Object.values(node as Record<string, unknown>)) {
      const hit = walk(value, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  return walk(root, 0);
}

export function isForwardPlaceholderPayload(
  payload: QuotedMessagePayload,
): boolean {
  if (
    Array.isArray(payload.content) &&
    payload.content.some((s) => s.type === "forward")
  ) {
    return true;
  }
  const raw = Array.isArray(payload.content)
    ? segment.raw(payload.content as MessageSegment[])
    : String(payload.content ?? payload.raw ?? "");
  return FORWARD_PLACEHOLDER_RE.test(raw);
}

function hasMergedForwardBlock(payload: QuotedMessagePayload): boolean {
  const raw = Array.isArray(payload.content)
    ? segment.raw(payload.content as MessageSegment[])
    : String(payload.content ?? "");
  return raw.includes("[Merged chat history");
}

function senderLabel(sender: unknown): string {
  if (!sender || typeof sender !== "object") return "unknown";
  const s = sender as Record<string, unknown>;
  const name = s.nickname ?? s.name ?? s.card;
  const id = s.user_id ?? s.uin ?? s.uid ?? s.id;
  if (name && id) return `${name} (${id})`;
  if (name) return String(name);
  if (id != null) return String(id);
  return "unknown";
}

function messageBodyToText(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body.trim();
  if (Array.isArray(body)) {
    const segs = icqqElementsToSegments(body as IcqqMessageElement[]);
    return segs?.length ? segment.raw(segs).trim() : segment.raw(body).trim();
  }
  if (typeof body === "object") {
    const r = body as Record<string, unknown>;
    if (typeof r.raw_message === "string" && r.raw_message.trim()) {
      return r.raw_message.trim();
    }
    if (Array.isArray(r.message)) {
      return messageBodyToText(r.message);
    }
    if (Array.isArray(r.elements)) {
      return messageBodyToText(r.elements);
    }
    if (typeof r.content === "string") return r.content.trim();
  }
  return "";
}

/** 将 get_forward_msg 响应格式化为可读聊天记录 */
export function formatForwardMsgResponse(data: unknown): string {
  if (!data) return "";

  const root =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;

  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(root?.messages)
      ? (root!.messages as unknown[])
      : Array.isArray(root?.msgList)
        ? (root!.msgList as unknown[])
        : Array.isArray(root?.msg_list)
          ? (root!.msg_list as unknown[])
          : Array.isArray(root?.message)
            ? (root!.message as unknown[])
            : [];

  if (!list.length) return "";

  const lines: string[] = [];
  let index = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    index += 1;
    const who = senderLabel(row.sender ?? row.user);
    const time =
      typeof row.time === "number"
        ? new Date(row.time * (row.time > 1e12 ? 1 : 1000)).toISOString()
        : "";
    const text = messageBodyToText(
      row.message ??
        row.content ??
        row.raw_message ??
        row.elements ??
        row,
    );
    const head = time ? `${index}. ${who} @ ${time}` : `${index}. ${who}`;
    lines.push(text ? `${head}\n${text}` : `${head}\n(非文本或无法解析的内容)`);
  }
  return lines.join("\n\n");
}

export async function fetchForwardMsgText(
  ipc: IpcClient,
  id: string,
): Promise<string> {
  const attempts: Record<string, unknown>[] = [
    { message_id: id },
    { id },
    { resid: id },
    { res_id: id },
    { msg_id: id },
  ];
  for (const params of attempts) {
    const resp = await ipc.request(Actions.GET_FORWARD_MSG, params);
    if (!resp.ok) continue;
    const text = formatForwardMsgResponse(resp.data);
    if (text.trim()) return text.trim();
  }
  return "";
}

function appendForwardBlock(
  payload: QuotedMessagePayload,
  block: string,
): QuotedMessagePayload {
  if (Array.isArray(payload.content)) {
    return {
      ...payload,
      content: [...payload.content, { type: "text", data: { text: block } }],
    };
  }
  const prev =
    typeof payload.content === "string" ? payload.content.trim() : "";
  return {
    ...payload,
    content: prev ? `${prev}\n\n${block}` : block,
  };
}

/** 若 payload 含合并转发，拉取并追加到 content */
export async function enrichQuotedPayloadWithForward(
  ipc: IpcClient | null | undefined,
  payload: QuotedMessagePayload,
  ipcRaw?: unknown,
): Promise<QuotedMessagePayload> {
  if (!ipc || hasMergedForwardBlock(payload)) return payload;

  const resid =
    extractForwardResidFromPayload(payload) ??
    (ipcRaw ? extractForwardResidFromGetMsg(ipcRaw) : undefined) ??
    (ipcRaw ? extractForwardResidDeep(ipcRaw) : undefined);

  const fetchIds = [
    resid,
    isForwardPlaceholderPayload(payload) ? payload.messageId : undefined,
  ].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);

  for (const fetchId of fetchIds) {
    const forwardText = await fetchForwardMsgText(ipc, fetchId);
    if (!forwardText.trim()) continue;
    const block = `[Merged chat history — id ${fetchId}]\n${forwardText.trim()}`;
    return appendForwardBlock(payload, block);
  }

  return payload;
}
