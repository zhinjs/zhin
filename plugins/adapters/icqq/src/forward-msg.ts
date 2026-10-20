import {
  icqqElementsToSegments,
  type IcqqMessageElement,
} from "./icqq-inbound.js";
import { toCanonicalSegments } from '@zhin.js/core';
import type { ForwardEntry, Segment } from '@zhin.js/im-contract';

const RESID_IN_XML_RE =
  /(?:m_resid|resid|fileid|res_id)=["']?([A-Za-z0-9+/=_.-]{8,})/i;

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

/** Canonical merged-forward entries. Speakers are data actors, never LLM roles. */
export function normalizeForwardMsgResponse(data: unknown): readonly ForwardEntry[] {
  const root = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : undefined;
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(root?.messages) ? root.messages as unknown[]
      : Array.isArray(root?.msgList) ? root.msgList as unknown[]
        : Array.isArray(root?.msg_list) ? root.msg_list as unknown[]
          : Array.isArray(root?.message) ? root.message as unknown[]
            : [];
  return Object.freeze(list.flatMap((item): ForwardEntry[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const sender = row.sender && typeof row.sender === 'object'
      ? row.sender as Record<string, unknown>
      : row.user && typeof row.user === 'object'
        ? row.user as Record<string, unknown>
        : undefined;
    const id = sender?.user_id ?? sender?.uin ?? sender?.id;
    const displayName = sender?.nickname ?? sender?.card ?? sender?.name;
    const body = row.message ?? row.content ?? row.elements ?? row.raw_message;
    let segments: Segment[];
    if (Array.isArray(body)) segments = toCanonicalSegments(icqqElementsToSegments(body as IcqqMessageElement[]) ?? body);
    else if (typeof body === 'string' && body.trim()) segments = [{ type: 'text', data: { text: body.trim() } }];
    else segments = [];
    if (segments.length === 0) return [];
    return [Object.freeze({
      ...(id != null ? { actor: Object.freeze({
        id: String(id),
        ...(displayName != null && String(displayName).trim() ? { displayName: String(displayName) } : {}),
      }) } : {}),
      ...(typeof row.time === 'number' ? { timestamp: row.time < 1e12 ? row.time * 1000 : row.time } : {}),
      segments: Object.freeze(segments),
    })];
  }));
}
