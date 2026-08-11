import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MediaRef } from '@zhin.js/core';
import type { MediaContentBlock } from '@zhin.js/ai';
import type { MediaBinaryPayload, MediaKind } from './media-types.js';

function kindFromSegmentType(type: string): MediaKind | null {
  if (type === 'image') return 'image';
  if (type === 'audio' || type === 'record' || type === 'voice') return 'audio';
  if (type === 'video') return 'video';
  return null;
}

function kindFromMime(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

function parseDataUri(dataUri: string): { mime: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUri.trim());
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

function resolveLocalMediaPath(value: string): string | null {
  const normalized = value.trim().replace(/^(?:"|')|(?:"|')$/g, '');
  if (!normalized || normalized.startsWith('data:') || /^https?:\/\//i.test(normalized)) return null;
  if (normalized.startsWith('file://')) {
    try {
      return fileURLToPath(normalized);
    } catch {
      return null;
    }
  }
  return path.isAbsolute(normalized) ? normalized : path.resolve(process.cwd(), normalized);
}

function mimeFromExtension(filePath: string): { kind: MediaKind; mimeType: string } {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    if (ext === '.png') return { kind: 'image', mimeType: 'image/png' };
    if (ext === '.gif') return { kind: 'image', mimeType: 'image/gif' };
    if (ext === '.webp') return { kind: 'image', mimeType: 'image/webp' };
    if (ext === '.bmp') return { kind: 'image', mimeType: 'image/bmp' };
    return { kind: 'image', mimeType: 'image/jpeg' };
  }
  if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
    return { kind: 'audio', mimeType: ext === '.wav' ? 'audio/wav' : 'audio/mpeg' };
  }
  if (['.mp4', '.webm', '.mov'].includes(ext)) {
    return { kind: 'video', mimeType: 'video/mp4' };
  }
  return { kind: 'file', mimeType: 'application/octet-stream' };
}

/** 读取本地媒体文件为 base64（相对路径相对 process.cwd()） */
export async function readLocalFileAsBase64(
  filePath: string,
  maxBytes: number,
): Promise<MediaBinaryPayload | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const buf = await fs.readFile(filePath);
    const { kind, mimeType } = mimeFromExtension(filePath);
    return {
      kind,
      base64: buf.toString('base64'),
      mimeType,
      fileName: path.basename(filePath),
    };
  } catch {
    return null;
  }
}

export async function fetchUrlAsBase64(url: string, maxBytes: number): Promise<MediaBinaryPayload | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
    let kind: MediaKind = 'file';
    if (mime.startsWith('image/')) kind = 'image';
    else if (mime.startsWith('audio/')) kind = 'audio';
    else if (mime.startsWith('video/')) kind = 'video';
    return { kind, base64: buf.toString('base64'), mimeType: mime };
  } catch {
    return null;
  }
}

/**
 * canonical 媒体引用（SegmentMediaRef 形状）→ MediaBinaryPayload[]。
 * base64 直取；path 读本地文件；url 按需 fetch；kind=file（平台不透明引用）跳过。
 */
export async function normalizeMediaRefsToPayloads(
  refs: readonly { type: string; media: MediaRef }[],
  maxBytes: number,
): Promise<MediaBinaryPayload[]> {
  const out: MediaBinaryPayload[] = [];

  for (const { type, media } of refs) {
    if (!media || media.kind === 'file') continue;
    if (typeof media.size === 'number' && media.size > maxBytes) continue;
    const wantKind = kindFromSegmentType(type);
    const fileName = media.file_name ? { fileName: media.file_name } : {};

    if (media.kind === 'base64') {
      const dataUri = parseDataUri(media.value);
      const base64 = (dataUri?.base64 ?? media.value).replace(/^base64:\/\//, '');
      const mimeType = dataUri?.mime ?? media.mime_type ?? 'application/octet-stream';
      out.push({ kind: wantKind ?? kindFromMime(mimeType), base64, mimeType, ...fileName });
      continue;
    }

    if (media.kind === 'path') {
      const local = await readLocalFileAsBase64(media.value, maxBytes);
      if (local) out.push({ ...local, kind: wantKind ?? local.kind, ...fileName });
      continue;
    }

    const fetched = await fetchUrlAsBase64(media.value, maxBytes);
    if (fetched) out.push({ ...fetched, kind: wantKind ?? fetched.kind, ...fileName });
  }

  return out;
}


export function payloadToDataUri(payload: MediaBinaryPayload): string {
  return `data:${payload.mimeType};base64,${payload.base64}`;
}



export function payloadToVisionPart(payload: MediaBinaryPayload): MediaContentBlock | null {
  if (payload.kind !== 'image') return null;
  return {
    type: 'image',
    data: {
      media: {
        kind: 'base64',
        value: payload.base64,
        mime_type: payload.mimeType,
        ...(payload.fileName ? { file_name: payload.fileName } : {}),
      },
    },
  };
}
