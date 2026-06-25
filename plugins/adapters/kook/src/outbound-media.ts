/**
 * KOOK 出站 media：base64 / 本地文件须先走 /v3/asset/create 上传，再嵌入 KMarkdown。
 */
import type { MessageElement, MessageSegment, SendContent } from "zhin.js";
import {
  asMessageElements,
  extractBase64Buffer,
  isMediaSegmentType,
  isRemoteUrl,
  resolveLocalMediaPath,
} from "zhin.js";

export interface KookMediaUploader {
  uploadMedia(data: string | Buffer): Promise<string>;
}

function isMessageSegment(seg: MessageElement): seg is MessageSegment {
  return typeof seg.type === "string";
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
  if (!isMediaSegmentType(seg.type)) return seg;

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

  const local = resolveLocalMediaPath(data);
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
  const segments = asMessageElements(content);
  return Promise.all(segments.map(async (item) => {
    if (!isMessageSegment(item)) return item;
    return resolveMediaSegment(uploader, item);
  }));
}
