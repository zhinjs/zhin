/**
 * CQ 码与 MessageSegment 互转。
 * 出站：@icqqjs/cli 要求 message 为非空字符串；引用段编码为 [reply:id]（需 cli parse-message 支持 reply，见 scripts/patch-icqq-cli-reply.mjs）。
 */
import { MessageSegment, segment, SendContent } from "zhin.js";

const MAX_CQ_PARSE_LEN = 256_000;

function pushCqSegment(segments: MessageSegment[], type: string, arg: string): void {
  switch (type) {
    case "face":
      segments.push({ type: "face", data: { id: Number(arg) } });
      break;
    case "image":
      segments.push({ type: "image", data: { url: arg, file: arg } });
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
      segments.push({ type: "record", data: { file: arg } });
      break;
    case "video":
      segments.push({ type: "video", data: { file: arg } });
      break;
    case "reply":
      segments.push({ type: "reply", data: { message_id: arg } });
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

/** 构建 icqq IPC send_*_msg 的 message 字符串（非空） */
export function buildIcqqIpcMessage(content: SendContent): string {
  let message = toCqString(content).trim();
  if (!message) message = "\u200b";
  return message;
}

export function toCqString(content: SendContent): string {
  if (!Array.isArray(content)) content = [content];
  return content
    .map((seg) => {
      if (typeof seg === "string") return seg;
      const { type, data } = seg as MessageSegment;
      switch (type) {
        case "text":
          return data.text ?? "";
        case "face":
          return `[face:${data.id}]`;
        case "image": {
          const media = data.media as { kind?: string; value?: string } | undefined;
          if (media?.value) {
            if (media.kind === "base64") return `[image:base64://${media.value}]`;
            return `[image:${media.value}]`;
          }
          const b64 =
            typeof data.base64 === "string"
              ? data.base64
              : typeof data.data === "string"
                ? data.data
                : undefined;
          if (b64) return `[image:base64://${b64}]`;
          return `[image:${data.file || data.url || data.src}]`;
        }
        case "at":
          return `[at:${data.qq ?? data.id}]`;
        case "dice":
          return "[dice]";
        case "rps":
          return "[rps]";
        case "record":
        case "audio": {
          const b64 =
            typeof data.base64 === "string"
              ? data.base64
              : typeof data.data === "string"
                ? data.data
                : undefined;
          if (b64) return `[record:base64://${b64}]`;
          return `[record:${data.file || data.url}]`;
        }
        case "video": {
          const b64 = typeof data.base64 === "string" ? data.base64 : undefined;
          if (b64) return `[video:base64://${b64}]`;
          return `[video:${data.file || data.url}]`;
        }
        case "reply":
          return `[reply:${data.message_id ?? data.id}]`;
        default:
          return segment.toString(seg);
      }
    })
    .join("");
}
