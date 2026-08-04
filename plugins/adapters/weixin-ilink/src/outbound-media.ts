/**
 * 微信 iLink 出站媒体物化：canonical MediaRef（`data.media`，MediaRef-only）→ 本地文件，
 * 再由 sendWeixinMediaFile 走 CDN 上传。
 * - kind=url    → 下载落盘后上传；
 * - kind=base64 → 解码落盘后上传；
 * - kind=path   → 本地文件直接上传；
 * - kind=file   → 微信无不透明平台引用投递面，warn 丢弃。
 * 无 media 或物化失败的媒体段 warn 丢弃（weixin_ilink_outbound_media_dropped）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isMediaRef, type MediaRef } from '@zhin.js/core';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { downloadRemoteImageToTemp } from './upload.js';
import { getExtensionFromMime } from './mime.js';
import type { WeixinWireSegment } from './protocol.js';

const logger = getLogger('weixin-ilink');

const MEDIA_TYPES = new Set(['image', 'video', 'file', 'record', 'audio']);

export type OutboundWireContent = string | WeixinWireSegment | ReadonlyArray<string | WeixinWireSegment>;

function dropMediaSegment(type: string, reason: string): null {
  logger.warn(formatCompact({
    op: 'weixin_ilink_outbound_media_dropped',
    type,
    reason,
  }));
  return null;
}

function resolveExt(seg: WeixinWireSegment, media: MediaRef): string {
  if (media.file_name) {
    const ext = path.extname(media.file_name);
    if (ext) return ext;
  }
  if (media.mime_type) {
    return getExtensionFromMime(media.mime_type) ?? '.bin';
  }
  if (seg.type === 'image') return '.png';
  if (seg.type === 'video') return '.mp4';
  if (seg.type === 'record' || seg.type === 'audio') return '.mp3';
  return '.bin';
}

function withLocalPath(seg: WeixinWireSegment, media: MediaRef, filePath: string): WeixinWireSegment {
  return {
    type: seg.type,
    data: { ...(seg.data ?? {}), media: { ...media, kind: 'path', value: filePath } },
  };
}

function writeOutboundBuffer(buffer: Buffer, outboundDir: string, seg: WeixinWireSegment, media: MediaRef): string {
  fs.mkdirSync(outboundDir, { recursive: true });
  const ext = resolveExt(seg, media);
  const filePath = path.join(
    outboundDir,
    `out-${seg.type}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`,
  );
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function materializeSegment(
  seg: WeixinWireSegment,
  outboundDir: string,
): Promise<WeixinWireSegment | null> {
  if (!MEDIA_TYPES.has(seg.type)) return seg;

  const media = (seg.data ?? {}).media;
  if (!isMediaRef(media)) {
    return dropMediaSegment(seg.type, 'missing_media_ref');
  }

  switch (media.kind) {
    case 'url': {
      try {
        const downloaded = await downloadRemoteImageToTemp(media.value, outboundDir);
        return withLocalPath(seg, media, downloaded);
      } catch (err) {
        logger.warn(formatCompact({
          op: 'weixin_ilink_outbound_media_dropped',
          type: seg.type,
          reason: 'download_failed',
          error: err instanceof Error ? err.message : String(err),
        }));
        return null;
      }
    }
    case 'base64':
      return withLocalPath(
        seg,
        media,
        writeOutboundBuffer(Buffer.from(media.value, 'base64'), outboundDir, seg, media),
      );
    case 'path': {
      if (!fs.existsSync(media.value)) {
        return dropMediaSegment(seg.type, 'missing_source');
      }
      return withLocalPath(seg, media, media.value);
    }
    case 'file':
      // 平台不透明引用（如 Telegram file_id）：微信 iLink 无对应投递面
      return dropMediaSegment(seg.type, 'unsupported_media_kind');
  }
}

function asSegments(content: OutboundWireContent): WeixinWireSegment[] {
  if (typeof content === 'string') {
    return [{ type: 'text', data: { text: content } }];
  }
  if (!Array.isArray(content)) {
    return typeof content === 'object' && content !== null && 'type' in content
      ? [content]
      : [];
  }
  return content.flatMap((item) => {
    if (typeof item === 'string') return [{ type: 'text', data: { text: item } }];
    return typeof item === 'object' && item !== null && 'type' in item ? [item] : [];
  });
}

/** 将 canonical MediaRef 媒体段物化为本地文件（kind=path），供 sendWeixinMediaFile 上传 */
export async function materializeOutboundMedia(
  content: OutboundWireContent,
  outboundDir: string,
): Promise<OutboundWireContent> {
  const segments = asSegments(content);
  const out = (await Promise.all(segments.map((seg) => materializeSegment(seg, outboundDir))))
    .filter((seg): seg is WeixinWireSegment => seg !== null);
  if (typeof content === 'string') {
    return out[0]?.type === 'text' ? String((out[0].data as { text?: string })?.text ?? content) : content;
  }
  if (!Array.isArray(content)) {
    // 单个媒体段被丢弃时降级为空文本，避免未物化段漏到 endpoint
    return out[0] ?? { type: 'text', data: { text: '' } };
  }
  return out;
}
