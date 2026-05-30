/**
 * CQ 码与 MessageSegment 互转。
 * 出站：@icqqjs/cli 要求 message 为非空字符串；引用段编码为 [reply:id]（需 cli parse-message 支持 reply，见 scripts/patch-icqq-cli-reply.mjs）。
 */
import { MessageSegment, segment, SendContent } from "zhin.js";

export function parseCqMessage(raw: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const cqRegex = /\[([a-z_]+)(?::([^\]]*))?\]/g;
  let lastIndex = 0;

  for (const match of raw.matchAll(cqRegex)) {
    if (match.index! > lastIndex) {
      const text = raw.slice(lastIndex, match.index!);
      if (text) segments.push({ type: "text", data: { text } });
    }

    const type = match[1];
    const arg = match[2] ?? "";

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
        segments.push({ type: "reply", data: { id: arg } });
        break;
      default:
        segments.push({ type, data: { text: `[${type}:${arg}]` } });
        break;
    }

    lastIndex = match.index! + match[0].length;
  }

  if (lastIndex < raw.length) {
    const text = raw.slice(lastIndex);
    if (text) segments.push({ type: "text", data: { text } });
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
        case "image":
          return `[image:${data.file || data.url || data.src}]`;
        case "at":
          return `[at:${data.qq ?? data.id}]`;
        case "dice":
          return "[dice]";
        case "rps":
          return "[rps]";
        case "record":
        case "audio":
          return `[record:${data.file || data.url}]`;
        case "video":
          return `[video:${data.file || data.url}]`;
        case "reply":
          return `[reply:${data.id}]`;
        default:
          return segment.toString(seg);
      }
    })
    .join("");
}
