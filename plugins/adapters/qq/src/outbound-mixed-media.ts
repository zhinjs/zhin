/**
 * QQ 群/私聊图文混排（msg_type=7）。
 * 内联 base64 图无法作为 Markdown 公网 URL，须先上传 file_info 再与文本同条发送。
 */
import { randomInt } from "node:crypto";
import type { MessageSegment, SendContent } from "zhin.js";
import {
  asOutboundSegments,
  isTextImageMixedWithInlineMedia,
  splitReplyPrefix,
} from "./outbound-markdown.js";
import { resolveMediaFile } from "./outbound-media.js";

function textFromSegment(seg: MessageSegment): string {
  if (seg.type !== "text") return "";
  return seg.data.text ?? seg.data.content ?? "";
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function extractInlineFileData(source: string): string {
  if (source.startsWith("base64://")) return source.slice(9);
  if (/^data:[^/]+\/[^;]+;base64,/i.test(source)) {
    return source.replace(/^data:[^/]+\/[^;]+;base64,/i, "");
  }
  return source;
}

export function buildQqImageUploadPayload(
  imageSeg: MessageSegment,
): { file_type: 1; url?: string; file_data?: string } {
  const data = imageSeg.data;
  const url = typeof data.url === "string" ? data.url : undefined;
  const file = resolveMediaFile(data);
  const remote = [url, file].find((item) => item && isRemoteUrl(item));
  if (remote) {
    return { file_type: 1, url: remote };
  }
  const inline = file ?? url;
  if (!inline) {
    throw new Error("QQ 图文混排：图片段缺少 url/file/base64");
  }
  return { file_type: 1, file_data: extractInlineFileData(inline) };
}

export function buildTextImageMixedBodyText(body: MessageSegment[]): string {
  return body
    .map((seg) => {
      if (seg.type === "text") return textFromSegment(seg);
      if (seg.type === "at") return `<@${String(seg.data.user_id ?? "")}>`;
      return "";
    })
    .join("");
}

export function firstImageSegment(body: MessageSegment[]): MessageSegment | undefined {
  return body.find((seg) => seg.type === "image");
}

export function shouldSendTextImageMixedMedia(
  content: SendContent,
  mode: boolean | "auto" | undefined,
): boolean {
  if (mode === false) return false;
  const { body } = splitReplyPrefix(asOutboundSegments(content));
  return isTextImageMixedWithInlineMedia(body);
}

export interface QqMixedMediaMessagePayload {
  msg_type: 7;
  content: string;
  media: { file_info: string };
  msg_seq: number;
  msg_id?: string;
  event_id?: string;
}

export function buildMixedMediaMessagePayload(
  content: SendContent,
  fileInfo: string,
): QqMixedMediaMessagePayload {
  const segments = asOutboundSegments(content);
  const { prefix, body } = splitReplyPrefix(segments);
  const payload: QqMixedMediaMessagePayload = {
    msg_type: 7,
    content: buildTextImageMixedBodyText(body),
    media: { file_info: fileInfo },
    msg_seq: randomInt(1, 1_000_000),
  };
  const reply = prefix[prefix.length - 1];
  if (reply?.type === "reply") {
    if (typeof reply.data.event_id === "string") {
      payload.event_id = reply.data.event_id;
    } else if (reply.data.id != null) {
      payload.msg_id = String(reply.data.id);
    }
  }
  return payload;
}
