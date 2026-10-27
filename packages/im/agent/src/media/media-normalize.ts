import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MediaRef } from '@zhin.js/im-contract';
import type { MediaContentBlock } from '@zhin.js/ai';
import type { MediaBinaryPayload, MediaKind } from './media-types.js';
import { checkUrlNetworkAccess } from '../security/network-policy.js';
import { authorizeTurnFileInput } from '../security/turn-file-authority.js';
import type { ImageAssetPublisher } from './image-assets.js';

/**
 * Turn authority for media that model output references by local path or URL.
 * With it, a path must pass the same check as `read_file` and a URL needs the
 * Turn's network authority (domain allowlist applied to every redirect hop).
 * Omitted only by trusted host callers that already own the media.
 */
export interface OutboundMediaAuthority {
  readonly imageAssets?: ImageAssetPublisher;
  readonly filesystem?: Readonly<{ workspaceRoot: string; workingDirectory?: string }>;
  readonly network?: Readonly<{ enabled: boolean; httpsOnly?: boolean; allowedDomains?: readonly string[] }>;
}

/**
 * No filesystem and no network authority: model-referenced paths and URLs are refused,
 * while inline (base64) media — including tool-produced images and audio — still pass.
 * For delivery paths that carry no Turn policy of their own.
 */
export const NO_MEDIA_AUTHORITY: OutboundMediaAuthority = Object.freeze({});

/** Canonical path the Turn may read, or null when the Turn has no authority over it. */
export async function authorizeOutboundMediaPath(
  rawPath: string,
  authority: OutboundMediaAuthority | undefined,
): Promise<string | null> {
  if (!authority) return rawPath;
  const filesystem = authority.filesystem;
  if (!filesystem?.workspaceRoot) return null;
  const decision = await authorizeTurnFileInput(
    'read_file', { file_path: rawPath }, filesystem.workspaceRoot, filesystem.workingDirectory,
  );
  return decision.allowed ? String(decision.input.file_path) : null;
}

/** Network options for fetching model-referenced media, or null when the Turn has no network authority. */
export function authorizeOutboundMediaUrl(
  url: string,
  authority: OutboundMediaAuthority | undefined,
): { readonly allowedDomains: readonly string[] } | null {
  if (!authority) return { allowedDomains: [] };
  const network = authority.network;
  if (!network?.enabled) return null;
  const allowedDomains = [...(network.allowedDomains ?? [])];
  return checkUrlNetworkAccess(url, { httpsOnly: true, allowedDomains }).allowed ? { allowedDomains } : null;
}

function kindFromSegmentType(type: string): MediaKind | null {
  if (type === 'image') return 'image';
  if (type === 'audio' || type === 'record' || type === 'voice') return 'audio';
  if (type === 'video') return 'video';
  return null;
}

function sniffMedia(buffer: Buffer): Readonly<{ kind: MediaKind; mimeType: string }> | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'image', mimeType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'image', mimeType: 'image/jpeg' };
  }
  const head = buffer.subarray(0, 16).toString('ascii');
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return { kind: 'image', mimeType: 'image/gif' };
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return { kind: 'image', mimeType: 'image/webp' };
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE') return { kind: 'audio', mimeType: 'audio/wav' };
  if (head.startsWith('OggS')) return { kind: 'audio', mimeType: 'audio/ogg' };
  if (head.startsWith('ID3') || (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)) return { kind: 'audio', mimeType: 'audio/mpeg' };
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return { kind: 'video', mimeType: 'video/mp4' };
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { kind: 'video', mimeType: 'video/webm' };
  if (head.startsWith('%PDF-')) return { kind: 'file', mimeType: 'application/pdf' };
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return { kind: 'file', mimeType: 'application/zip' };
  }
  if (buffer.length > 0 && !buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0)) {
    const decoded = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8');
    const replacementRatio = [...decoded].filter((char) => char === '\uFFFD').length / Math.max(decoded.length, 1);
    if (replacementRatio < 0.01) return { kind: 'file', mimeType: 'text/plain' };
  }
  return null;
}

export function decodeBase64(value: string, maxBytes: number): Buffer | null {
  const normalized = value.replace(/^base64:\/\//, '').replace(/\s+/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  const estimatedBytes = Math.floor(normalized.length * 3 / 4);
  if (estimatedBytes > maxBytes + 2) return null;
  try {
    const buffer = Buffer.from(normalized, 'base64');
    return buffer.length <= maxBytes ? buffer : null;
  } catch {
    return null;
  }
}

export function inspectMediaBytes(
  buffer: Buffer,
  expectedKind?: MediaKind,
): Readonly<{ kind: MediaKind; mimeType: string }> | null {
  const detected = sniffMedia(buffer);
  if (!detected) return null;
  if (expectedKind && expectedKind !== 'file' && detected.kind !== expectedKind) return null;
  return detected;
}

function parseDataUri(dataUri: string): { mime: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUri.trim());
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

/** 读取本地媒体文件为 base64（相对路径相对 process.cwd()） */
export async function readLocalFileAsBase64(
  filePath: string,
  maxBytes: number,
  expectedKind?: MediaKind,
): Promise<MediaBinaryPayload | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const buf = await fs.readFile(filePath);
    const detected = inspectMediaBytes(buf, expectedKind);
    if (!detected) return null;
    return {
      kind: detected.kind,
      base64: buf.toString('base64'),
      mimeType: detected.mimeType,
      fileName: path.basename(filePath),
    };
  } catch {
    return null;
  }
}

export async function fetchUrlAsBase64(
  url: string,
  maxBytes: number,
  expectedKind?: MediaKind,
  signal?: AbortSignal,
  allowedDomains: readonly string[] = [],
): Promise<MediaBinaryPayload | null> {
  try {
    let current = url;
    let res: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!checkUrlNetworkAccess(current, { httpsOnly: true, allowedDomains: [...allowedDomains] }).allowed) return null;
      res = await fetch(current, {
        redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const location = res.headers.get('location');
      if (!location || redirects === 5) return null;
      current = new URL(location, current).toString();
    }
    if (!res?.ok) return null;
    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
    const buf = await readBoundedResponse(res, maxBytes);
    if (!buf) return null;
    const detected = inspectMediaBytes(buf, expectedKind);
    if (!detected) return null;
    return { kind: detected.kind, base64: buf.toString('base64'), mimeType: detected.mimeType };
  } catch {
    return null;
  }
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Buffer | null> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('media_byte_limit_exceeded');
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}

/**
 * canonical 媒体引用（SegmentMediaRef 形状）→ MediaBinaryPayload[]。
 * base64 直取；path 读本地文件；url 按需 fetch；kind=file（平台不透明引用）跳过。
 */
export async function normalizeMediaRefsToPayloads(
  refs: readonly { type: string; media: MediaRef }[],
  maxBytes: number,
  signal?: AbortSignal,
  authority?: OutboundMediaAuthority,
): Promise<MediaBinaryPayload[]> {
  const out: MediaBinaryPayload[] = [];

  for (const { type, media } of refs) {
    signal?.throwIfAborted();
    if (!media || media.kind === 'file') continue;
    if (typeof media.size === 'number' && media.size > maxBytes) continue;
    const wantKind = kindFromSegmentType(type);
    const fileName = media.file_name ? { fileName: media.file_name } : {};

    if (media.kind === 'base64') {
      const dataUri = parseDataUri(media.value);
      const base64 = (dataUri?.base64 ?? media.value).replace(/^base64:\/\//, '');
      const bytes = decodeBase64(base64, maxBytes);
      const detected = bytes ? inspectMediaBytes(bytes, wantKind ?? undefined) : null;
      if (detected) out.push({ kind: detected.kind, base64: bytes!.toString('base64'), mimeType: detected.mimeType, ...fileName });
      continue;
    }

    if (media.kind === 'path') {
      const authorized = await authorizeOutboundMediaPath(media.value, authority);
      if (!authorized) continue;
      const local = await readLocalFileAsBase64(authorized, maxBytes, wantKind ?? undefined);
      if (local) out.push({ ...local, ...fileName });
      continue;
    }

    const network = authorizeOutboundMediaUrl(media.value, authority);
    if (!network) continue;
    const fetched = await fetchUrlAsBase64(media.value, maxBytes, wantKind ?? undefined, signal, network.allowedDomains);
    if (fetched) out.push({ ...fetched, ...fileName });
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
