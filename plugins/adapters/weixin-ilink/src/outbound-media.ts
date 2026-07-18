/**
 * 微信 iLink 出站媒体：base64 / 远程 URL 须落盘后再走 CDN 上传。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { downloadRemoteImageToTemp } from './upload.js';
import { getExtensionFromMime } from './mime.js';
import type { WeixinWireSegment } from './protocol.js';

const MEDIA_TYPES = new Set(['image', 'video', 'file', 'record', 'audio']);

export type OutboundWireContent = string | WeixinWireSegment | ReadonlyArray<string | WeixinWireSegment>;

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isInlineMediaRef(value: string): boolean {
  return value.startsWith('base64://') || /^data:[^/]+\/[^;]+;base64,/i.test(value);
}

function normalizeLocalPath(value: string): string {
  return value.replace(/^file:\/\//, '');
}

export function segmentMediaRef(seg: WeixinWireSegment): string | undefined {
  const data = seg.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  const candidates = [data.file, data.path, data.url].filter(
    (v): v is string => typeof v === 'string' && Boolean(v),
  );
  return candidates[0];
}

function extractBase64Buffer(data: Record<string, unknown>): Buffer | undefined {
  const url = typeof data.url === 'string' ? data.url : undefined;
  const file = typeof data.file === 'string' ? data.file : undefined;
  const base64 = typeof data.base64 === 'string' ? data.base64 : undefined;

  if (url?.startsWith('base64://')) {
    return Buffer.from(url.slice(9), 'base64');
  }
  if (url && /^data:[^/]+\/[^;]+;base64,/i.test(url)) {
    return Buffer.from(url.replace(/^data:[^/]+\/[^;]+;base64,/, ''), 'base64');
  }
  if (file?.startsWith('base64://')) {
    return Buffer.from(file.slice(9), 'base64');
  }
  if (base64) {
    const raw = base64.startsWith('base64://') ? base64.slice(9) : base64;
    return Buffer.from(raw, 'base64');
  }
  return undefined;
}

function resolveExt(seg: WeixinWireSegment, mime?: string): string {
  const data = (seg.data ?? {}) as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name : undefined;
  if (name) {
    const ext = path.extname(name);
    if (ext) return ext;
  }
  const mimeHint = mime
    ?? (typeof data.mime === 'string' ? data.mime : typeof data.mimeType === 'string' ? data.mimeType : undefined);
  if (mimeHint) {
    return getExtensionFromMime(mimeHint) ?? '.bin';
  }
  if (seg.type === 'image') return '.png';
  if (seg.type === 'video') return '.mp4';
  if (seg.type === 'record' || seg.type === 'audio') return '.mp3';
  return '.bin';
}

function withLocalFile(seg: WeixinWireSegment, filePath: string): WeixinWireSegment {
  const data = { ...(seg.data ?? {}), file: filePath } as Record<string, unknown>;
  delete data.base64;
  return { type: seg.type, data };
}

function writeOutboundBuffer(buffer: Buffer, outboundDir: string, seg: WeixinWireSegment): string {
  fs.mkdirSync(outboundDir, { recursive: true });
  const ext = resolveExt(seg);
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
): Promise<WeixinWireSegment> {
  if (!MEDIA_TYPES.has(seg.type)) return seg;

  const ref = segmentMediaRef(seg);
  if (ref && !isInlineMediaRef(ref)) {
    const local = normalizeLocalPath(ref);
    if (isRemoteUrl(local)) {
      const downloaded = await downloadRemoteImageToTemp(local, outboundDir);
      return withLocalFile(seg, downloaded);
    }
    if (fs.existsSync(local)) {
      return withLocalFile(seg, local);
    }
  }

  const buffer = extractBase64Buffer((seg.data ?? {}) as Record<string, unknown>);
  if (buffer) {
    return withLocalFile(seg, writeOutboundBuffer(buffer, outboundDir, seg));
  }

  return seg;
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

/** 将 base64 / 远程图落盘，供 sendWeixinMediaFile 上传 */
export async function materializeOutboundMedia(
  content: OutboundWireContent,
  outboundDir: string,
): Promise<OutboundWireContent> {
  const segments = asSegments(content);
  const out = await Promise.all(segments.map((seg) => materializeSegment(seg, outboundDir)));
  if (typeof content === 'string') {
    return out[0]?.type === 'text' ? String((out[0].data as { text?: string })?.text ?? content) : content;
  }
  if (!Array.isArray(content)) {
    return out[0] ?? content;
  }
  return out;
}
