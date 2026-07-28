/**
 * Lark 图片上传（im/v1 消息 image 段需要 image_key）。
 * 接口：POST {apiBaseUrl}/im/v1/images（multipart：image_type=message + image）
 * 与 im/v1/messages 同属 IM 接口域（同一 tenant_access_token），不引入额外授权域。
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { isMediaRef, mediaRefFromLegacyData, type MediaRef } from '@zhin.js/core';

export interface MediaBinary {
  readonly data: Buffer;
  readonly mimeType: string;
  readonly fileName: string;
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

/** 从 canonical MediaRef 解析二进制：base64 解码 / 本地读盘 / URL 下载。 */
export async function resolveMediaBinary(
  media: MediaRef,
  download: (url: string) => Promise<Buffer> = defaultDownload,
): Promise<MediaBinary> {
  const mimeType = media.mime_type ?? 'image/png';
  const ext = MIME_EXT[mimeType] ?? 'png';
  if (media.kind === 'base64') {
    const value = media.value.startsWith('base64://')
      ? media.value.slice('base64://'.length)
      : media.value;
    return { data: Buffer.from(value, 'base64'), mimeType, fileName: `image.${ext}` };
  }
  if (media.kind === 'path') {
    const path = media.value.startsWith('file://') ? media.value.slice('file://'.length) : media.value;
    return { data: await readFile(path), mimeType, fileName: basename(path) };
  }
  return { data: await download(media.value), mimeType, fileName: `image.${ext}` };
}

async function defaultDownload(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** /im/v1/images 的 multipart body（image_type=message 用于消息内图片）。 */
export function buildImageUploadForm(binary: MediaBinary): FormData {
  // Buffer 的 ArrayBufferLike 不满足 BlobPart（SharedArrayBuffer 分支），拷贝为 Uint8Array<ArrayBuffer>
  const bytes = new Uint8Array(binary.data.byteLength);
  bytes.set(binary.data);
  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([bytes], { type: binary.mimeType }), binary.fileName);
  return form;
}

/**
 * 出站 image 段的媒体引用：已有 image_key/file_key 的视为已物化；
 * 否则读 canonical `data.media`，兼容旧 wire `{url,file,base64}` 字段。
 */
export function readOutboundImageMedia(data: Record<string, unknown>): MediaRef | undefined {
  if (typeof data.image_key === 'string' && data.image_key) return undefined;
  if (typeof data.file_key === 'string' && data.file_key) return undefined;
  if (typeof data.key === 'string' && data.key) return undefined;
  if (isMediaRef(data.media)) return data.media;
  return mediaRefFromLegacyData(data);
}
