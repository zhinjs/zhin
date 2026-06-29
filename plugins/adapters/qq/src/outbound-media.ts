/**
 * QQ 官方出站媒体归一化。
 * qq-official-bot 的 formatMediaData 对 data.url 直接当远程 URL 上传；
 * base64:// / data:...;base64 须走 data.file 才会解析为 file_data。
 */
import type { MessageElement, MessageSegment, SendContent } from "zhin.js";

const MEDIA_TYPES = new Set(["image", "audio", "video", "file"]);

function isMessageSegment(seg: MessageElement): seg is MessageSegment {
  return typeof seg.type === "string";
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isInlineBase64(value: string): boolean {
  return value.startsWith("base64://") || /^data:[^/]+\/[^;]+;base64,/i.test(value);
}

/** 解析 image/audio/video/file 段的本地或内联 payload（供 mixed-media 上传复用） */
export function resolveMediaFile(data: Record<string, unknown>): string | undefined {
  const url = typeof data.url === "string" ? data.url : undefined;
  const file = typeof data.file === "string" ? data.file : undefined;
  const base64 = typeof data.base64 === "string" ? data.base64 : undefined;

  if (file && !isRemoteUrl(file)) return file;
  if (url && isInlineBase64(url)) return url;
  if (url && !isRemoteUrl(url) && (url.startsWith("file://") || url.startsWith("/"))) return url;
  if (base64) return base64.startsWith("base64://") ? base64 : `base64://${base64}`;
  return undefined;
}

function normalizeMediaSegment(seg: MessageSegment): MessageSegment {
  if (!MEDIA_TYPES.has(seg.type)) return seg;

  const data = { ...seg.data } as Record<string, unknown>;
  const file = resolveMediaFile(data);
  if (!file) return seg;

  delete data.url;
  delete data.base64;
  data.file = file;
  return { type: seg.type, data } as MessageSegment;
}

/** 将 Zhin 出站 image/base64 段转为 qq-official-bot 可识别的 file 字段 */
export function normalizeOutboundMedia(content: SendContent): SendContent {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    return isMessageSegment(content) ? normalizeMediaSegment(content) : content;
  }
  return content.map((item) => {
    if (typeof item === "string") return item;
    return isMessageSegment(item) ? normalizeMediaSegment(item) : item;
  });
}
