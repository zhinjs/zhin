/**
 * KOOK 出站媒体：base64 / 本地文件须先走 /v3/asset/create 上传，再嵌入 KMarkdown。
 */
import type { MessageElement, MessageSegment, SendContent } from "zhin.js";

const MEDIA_TYPES = new Set(["image", "audio", "video", "file"]);

export interface KookMediaUploader {
  uploadMedia(data: string | Buffer): Promise<string>;
}

function isMessageSegment(seg: MessageElement): seg is MessageSegment {
  return typeof seg.type === "string";
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function asSegments(content: SendContent): MessageElement[] {
  if (typeof content === "string") {
    return [{ type: "text", data: { text: content } }];
  }
  if (!Array.isArray(content)) {
    return [content];
  }
  return content.map((item) =>
    typeof item === "string" ? { type: "text", data: { text: item } } : item,
  );
}

function extractBase64Buffer(data: Record<string, unknown>): Buffer | undefined {
  const url = typeof data.url === "string" ? data.url : undefined;
  const file = typeof data.file === "string" ? data.file : undefined;
  const base64 = typeof data.base64 === "string" ? data.base64 : undefined;

  if (url?.startsWith("base64://")) {
    return Buffer.from(url.slice(9), "base64");
  }
  if (url && /^data:[^/]+\/[^;]+;base64,/i.test(url)) {
    return Buffer.from(url.replace(/^data:[^/]+\/[^;]+;base64,/, ""), "base64");
  }
  if (file?.startsWith("base64://")) {
    return Buffer.from(file.slice(9), "base64");
  }
  if (base64) {
    const raw = base64.startsWith("base64://") ? base64.slice(9) : base64;
    return Buffer.from(raw, "base64");
  }
  return undefined;
}

function resolveLocalFile(data: Record<string, unknown>): string | undefined {
  const url = typeof data.url === "string" ? data.url : undefined;
  const file = typeof data.file === "string" ? data.file : undefined;
  const candidate = file ?? url;
  if (!candidate || isRemoteUrl(candidate)) return undefined;
  if (candidate.startsWith("base64://") || /^data:/.test(candidate)) return undefined;
  if (candidate.startsWith("file://") || candidate.startsWith("/") || !candidate.includes("://")) {
    return candidate;
  }
  return undefined;
}

function withUploadedUrl(seg: MessageSegment, uploadedUrl: string): MessageSegment {
  const data = { ...seg.data } as Record<string, unknown>;
  data.url = uploadedUrl;
  data.file = uploadedUrl;
  delete data.base64;
  return { type: seg.type, data } as MessageSegment;
}

async function resolveMediaSegment(
  uploader: KookMediaUploader,
  seg: MessageSegment,
): Promise<MessageSegment> {
  if (!MEDIA_TYPES.has(seg.type)) return seg;

  const data = seg.data as Record<string, unknown>;
  const url = typeof data.url === "string" ? data.url : undefined;
  const file = typeof data.file === "string" ? data.file : undefined;
  if ((url && isRemoteUrl(url)) || (file && isRemoteUrl(file))) {
    return seg;
  }

  const buffer = extractBase64Buffer(data);
  if (buffer) {
    const uploaded = await uploader.uploadMedia(buffer);
    return withUploadedUrl(seg, uploaded);
  }

  const local = resolveLocalFile(data);
  if (local) {
    const uploaded = await uploader.uploadMedia(local);
    return withUploadedUrl(seg, uploaded);
  }

  return seg;
}

/** 将 base64 / 本地媒体上传为 KOOK 可访问 URL */
export async function materializeOutboundMedia(
  uploader: KookMediaUploader,
  content: SendContent,
): Promise<MessageElement[]> {
  const segments = asSegments(content);
  return Promise.all(segments.map(async (item) => {
    if (!isMessageSegment(item)) return item;
    return resolveMediaSegment(uploader, item);
  }));
}
