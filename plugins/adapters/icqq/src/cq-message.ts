/** ICQQ 历史文本视图 → canonical MessageSegment。出站只使用原生 Sendable。 */
import { isMediaRef, type MediaRef } from "@zhin.js/core";
import type { MessageSegment } from "zhin.js";

const MAX_CQ_PARSE_LEN = 256_000;

/**
 * CQ 媒体参数 / 入站元素媒体值 → canonical MediaRef：
 * `base64://` → base64；http(s) → url；本机路径 → path；其余视为平台不透明引用（file）。
 */
export function icqqMediaRefFromString(value: string): MediaRef {
  if (value.startsWith("base64://")) {
    return { kind: "base64", value: value.slice("base64://".length) };
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return { kind: "url", value };
  }
  if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) {
    return { kind: "path", value };
  }
  return { kind: "file", value };
}

/**
 * canonical MediaRef（`data.media`，唯一媒体来源）→ ICQQ native
 * element 的 file 参数。base64 使用 ICQQ 原生支持的 `base64://` 前缀。
 */
export function resolveIcqqMediaFile(
  data: Record<string, unknown> | undefined,
): string | undefined {
  const media = data?.media;
  if (!isMediaRef(media)) return undefined;
  if (media.kind === "base64") {
    return media.value.startsWith("base64://") ? media.value : `base64://${media.value}`;
  }
  return media.value;
}

function pushCqSegment(segments: MessageSegment[], type: string, arg: string): void {
  switch (type) {
    case "face":
      segments.push({ type: "face", data: { id: Number(arg) } });
      break;
    case "image":
      segments.push({ type: "image", data: { media: icqqMediaRefFromString(arg) } });
      break;
    case "at":
      if (arg === "all") {
        segments.push({ type: "at", data: { qq: "all" } });
      } else {
        segments.push({ type: "at", data: { qq: arg } });
      }
      break;
    case "dice":
      segments.push({ type: "dice", data: {} });
      break;
    case "rps":
      segments.push({ type: "rps", data: {} });
      break;
    case "record":
    case "audio":
      segments.push({ type: "record", data: { media: icqqMediaRefFromString(arg) } });
      break;
    case "video":
      segments.push({ type: "video", data: { media: icqqMediaRefFromString(arg) } });
      break;
    case "reply":
      segments.push({ type: "reply", data: { message_id: arg } });
      break;
    case "json":
      segments.push({ type: "json", data: { text: arg } });
      break;
    default:
      segments.push({ type, data: { text: `[${type}:${arg}]` } });
      break;
  }
}

export function parseCqMessage(raw: string): MessageSegment[] {
  const text = raw.length > MAX_CQ_PARSE_LEN ? raw.slice(0, MAX_CQ_PARSE_LEN) : raw;
  const segments: MessageSegment[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "[") {
      const next = text.indexOf("[", i);
      const chunk = next === -1 ? text.slice(i) : text.slice(i, next);
      if (chunk) segments.push({ type: "text", data: { text: chunk } });
      if (next === -1) break;
      i = next;
      continue;
    }

    const close = text.indexOf("]", i + 1);
    if (close === -1) {
      segments.push({ type: "text", data: { text: text.slice(i) } });
      break;
    }

    const inner = text.slice(i + 1, close);
    const colon = inner.indexOf(":");
    const type = (colon === -1 ? inner : inner.slice(0, colon)).trim().toLowerCase();
    const arg = colon === -1 ? "" : inner.slice(colon + 1);
    if (/^[a-z_]+$/.test(type)) {
      pushCqSegment(segments, type, arg);
    } else {
      segments.push({ type: "text", data: { text: text.slice(i, close + 1) } });
    }
    i = close + 1;
  }

  return segments.length ? segments : [{ type: "text", data: { text: raw } }];
}
