/**
 * WeCom 临时素材上传（message/send 的 image 段需要 media_id）。
 * 接口：POST {apiBaseUrl}/cgi-bin/media/upload?access_token=…&type=image
 * 与 message/send 同属应用消息接口域（同一 access_token），不引入额外授权域。
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { isMediaRef, type MediaRef } from '@zhin.js/core';

export interface MediaBinary {
  readonly data: Buffer;
  readonly mimeType: string;
  readonly fileName: string;
}

export interface WecomMediaUploadResult {
  readonly errcode?: number;
  readonly errmsg?: string;
  readonly type?: string;
  readonly media_id?: string;
  readonly created_at?: string;
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
  if (media.kind === 'url') {
    return { data: await download(media.value), mimeType, fileName: `image.${ext}` };
  }
  // kind=file 为平台不透明引用（media_id），无二进制可解，调用方应直用 value
  throw new Error(`cannot resolve binary from media kind: ${media.kind}`);
}

async function defaultDownload(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** 临时素材上传的 multipart body（字段名固定为 `media`）。 */
export function buildMediaUploadForm(binary: MediaBinary): FormData {
  // Buffer 的 ArrayBufferLike 不满足 BlobPart（SharedArrayBuffer 分支），拷贝为 Uint8Array<ArrayBuffer>
  const bytes = new Uint8Array(binary.data.byteLength);
  bytes.set(binary.data);
  const form = new FormData();
  form.append('media', new Blob([bytes], { type: binary.mimeType }), binary.fileName);
  return form;
}

/**
 * 出站 image 段的媒体引用：只读 canonical `data.media`（MediaRef）。
 * 中央 normalizeOutboundPayload 已保证到达 endpoint 的载荷为 canonical；
 * 无 MediaRef 时返回 undefined，由调用方 warn + 丢弃。
 */
export function readOutboundImageMedia(data: Record<string, unknown>): MediaRef | undefined {
  return isMediaRef(data.media) ? data.media : undefined;
}
