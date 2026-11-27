import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MediaRef } from '@zhin.js/im-contract';
import type { OutboundMediaTrust } from '@zhin.js/core';
import type { Locale } from '@zhin.js/plugin-runtime';
import type { MediaContentBlock } from '@zhin.js/ai';
import type { MediaBinaryPayload, MediaKind } from './media-types.js';
import { checkUrlNetworkAccess } from '../security/network-policy.js';
import { fetchPublicMediaBytes } from '../security/public-media-fetch.js';
import type { NetworkTransport } from '../security/turn-network-client.js';
import { authorizeTurnFileInput } from '../security/turn-file-authority.js';
import { checkFilePermission, type FileRole } from '../security/file-role-policy.js';
import type { ImageAssetPublisher } from './image-assets.js';

/**
 * Turn authority for media that model output references by local path or URL.
 * With it, a path must pass the same check as `read_file` and a URL needs the
 * Turn's network authority (domain allowlist applied to every redirect hop).
 * Omitted, no local path is read (#1250: fail closed, as {@link NO_MEDIA_AUTHORITY});
 * URLs keep the default fetch rules (HTTPS only, private addresses refused).
 */
export interface OutboundMediaAuthority {
  readonly imageAssets?: ImageAssetPublisher;
  readonly filesystem?: Readonly<{ workspaceRoot: string; workingDirectory?: string }>;
  readonly network?: Readonly<{ enabled: boolean; httpsOnly?: boolean; allowedDomains?: readonly string[] }>;
  /**
   * File role of the Turn's initiator (ADR 0056 §2: only a global owner is `owner`). Model-referenced
   * paths get the same read decision as `read_file`; a read that would need confirmation is refused,
   * because a reply attachment has no approval step. Absent: `user` (fail closed).
   */
  readonly fileRole?: FileRole;
  /** Replaces the pinned Node transport that downloads model-referenced URLs (tests, embedding hosts). */
  readonly mediaTransport?: NetworkTransport;
}

/**
 * No filesystem and no network authority: model-referenced paths and URLs are refused,
 * while inline (base64) media — including tool-produced images and audio — still pass.
 * For delivery paths that carry no Turn policy of their own.
 */
export const NO_MEDIA_AUTHORITY: OutboundMediaAuthority = Object.freeze({});

/**
 * Canonical path the Turn may read, or null when the Turn has no authority over it.
 * No authority is no filesystem authority: the path is refused (#1250).
 */
export async function authorizeOutboundMediaPath(
  rawPath: string,
  authority: OutboundMediaAuthority | undefined,
): Promise<string | null> {
  const filesystem = authority?.filesystem;
  if (!filesystem?.workspaceRoot) return null;
  const decision = await authorizeTurnFileInput(
    'read_file', { file_path: rawPath }, filesystem.workspaceRoot, filesystem.workingDirectory,
  );
  if (!decision.allowed) return null;
  const canonical = String(decision.input.file_path);
  const permission = checkFilePermission(authority?.fileRole ?? 'user', 'read', canonical);
  if (!permission.allowed || permission.needsConfirmation || permission.needsOwnerConfirmation) return null;
  return canonical;
}

/**
 * Core's untrusted-source media policy for content the model authored (ADR 0056 §2). Delivered
 * content is wrapped with `untrustedContent(content, trust)`: local paths pass only when the Turn's
 * file authority admits them (or the Agent built the MediaRef itself, see `trustedMediaRef`), and
 * `file` refs must be bare platform tokens, so a reply can never make an adapter read a host file.
 */
export function modelMediaTrust(
  source: string,
  authority: OutboundMediaAuthority,
  options: Readonly<{ locale?: Locale; maxInlineBytes?: number }> = {},
): OutboundMediaTrust {
  return Object.freeze({
    source,
    authorizePath: async (rawPath: string) => (await authorizeOutboundMediaPath(rawPath, authority)) ?? undefined,
    ...(options.locale ? { locale: options.locale } : {}),
    // The Endpoint's declared attachment limit already bounded what the publisher kept inline.
    ...(options.maxInlineBytes !== undefined ? { maxInlineBytes: options.maxInlineBytes } : {}),
  });
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
  const decoded = decodeBase64Detailed(value, maxBytes);
  return decoded.ok ? decoded.bytes : null;
}

/** {@link decodeBase64} that says why decoding failed: undecodable data or more than `maxBytes`. */
function decodeBase64Detailed(value: string, maxBytes: number):
  Readonly<{ ok: true; bytes: Buffer }> | Readonly<{ ok: false; reason: 'invalid_data' | 'too_large' }> {
  const normalized = value.replace(/^base64:\/\//, '').replace(/\s+/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return { ok: false, reason: 'invalid_data' };
  const estimatedBytes = Math.floor(normalized.length * 3 / 4);
  if (estimatedBytes > maxBytes + 2) return { ok: false, reason: 'too_large' };
  try {
    const buffer = Buffer.from(normalized, 'base64');
    return buffer.length <= maxBytes ? { ok: true, bytes: buffer } : { ok: false, reason: 'too_large' };
  } catch {
    return { ok: false, reason: 'invalid_data' };
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

/**
 * Why a media ref yielded no payload (#1250 inbound-media-reject-reason-opaque, ADR 0061 `media_rejected`):
 * `too_large` (declared size, inline data or body over the limit), `mime_mismatch` (the bytes are not the
 * declared kind or no known media type), `invalid_data` (undecodable inline data), `scheme_unsupported`
 * (not an HTTPS URL), `host_not_allowed` (private / loopback address, non-default port, domain not allowed,
 * refused redirect hop, or no network authority), `path_not_allowed` (no file authority over the path),
 * `file_unreadable`, `fetch_failed` (non-2xx status, timeout, connection or TLS error) and
 * `unmaterialized_platform_reference` (an opaque platform token, no bytes to read).
 */
export type MediaRefRejection =
  | 'too_large' | 'mime_mismatch' | 'invalid_data' | 'scheme_unsupported' | 'host_not_allowed'
  | 'path_not_allowed' | 'file_unreadable' | 'fetch_failed' | 'unmaterialized_platform_reference';

/**
 * Per-item result of {@link normalizeMediaRefs}. A refusal names where the media came from for logs:
 * `scheme` (`https`, `http`, `base64`, `path`, `platform`) and, for URLs, `host`. Never the path, query
 * string or inline data.
 */
export type MediaRefResult =
  | Readonly<{ ok: true; payload: MediaBinaryPayload }>
  | Readonly<{ ok: false; reason: MediaRefRejection; scheme: string; host?: string; status?: number }>;

function urlScheme(url: string): Readonly<{ scheme: string; host?: string }> {
  try {
    const parsed = new URL(url.trim());
    return { scheme: parsed.protocol.replace(/:$/u, ''), ...(parsed.hostname ? { host: parsed.hostname } : {}) };
  } catch {
    return { scheme: 'invalid' };
  }
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
  const result = await readLocalMedia(filePath, maxBytes, expectedKind);
  return result.ok ? result.payload : null;
}

/**
 * {@link readLocalFileAsBase64} with the reason (#1250): `too_large` (over `maxBytes`), `mime_mismatch`
 * (not the expected kind or no known media type), `file_unreadable` (missing, not a regular file, I/O error).
 */
async function readLocalMedia(
  filePath: string,
  maxBytes: number,
  expectedKind?: MediaKind,
): Promise<Readonly<{ ok: true; payload: MediaBinaryPayload }> | Readonly<{ ok: false; reason: 'too_large' | 'mime_mismatch' | 'file_unreadable' }>> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { ok: false, reason: 'file_unreadable' };
    if (stat.size > maxBytes) return { ok: false, reason: 'too_large' };
    const buf = await fs.readFile(filePath);
    if (buf.length > maxBytes) return { ok: false, reason: 'too_large' };
    const detected = inspectMediaBytes(buf, expectedKind);
    if (!detected) return { ok: false, reason: 'mime_mismatch' };
    return {
      ok: true,
      payload: {
        kind: detected.kind,
        base64: buf.toString('base64'),
        mimeType: detected.mimeType,
        fileName: path.basename(filePath),
      },
    };
  } catch {
    return { ok: false, reason: 'file_unreadable' };
  }
}

/**
 * Download a media URL someone outside the host controls (inbound image / video / file, a model-referenced
 * URL) and sniff its real type. Uses the pinned download shared with speech and outbound adapters
 * (`fetchPublicMediaBytes`, #1250 第 46 批): HTTPS only on port 443 (第 48 批; `trustedOrigins` — the
 * producing Endpoint's own protocol server — keep their port), private hosts refused, the name resolved once
 * and the connection made to the checked address (no DNS rebinding between check and connect), every
 * redirect hop checked again (including `allowedDomains`), body capped at `maxBytes`, 30 s overall.
 * Any refusal or failure yields `null`.
 */
export async function fetchUrlAsBase64(
  url: string,
  maxBytes: number,
  expectedKind?: MediaKind,
  signal?: AbortSignal,
  allowedDomains: readonly string[] = [],
  transport?: NetworkTransport,
  trustedOrigins: readonly string[] = [],
): Promise<MediaBinaryPayload | null> {
  const result = await fetchUrlMedia(url, maxBytes, expectedKind, signal, allowedDomains, transport, trustedOrigins);
  return result.ok ? result.payload : null;
}

/** {@link fetchUrlAsBase64} with the refusal reason, URL scheme and host (#1250 inbound-media-reject-reason-opaque). */
async function fetchUrlMedia(
  url: string,
  maxBytes: number,
  expectedKind: MediaKind | undefined,
  signal: AbortSignal | undefined,
  allowedDomains: readonly string[],
  transport: NetworkTransport | undefined,
  trustedOrigins: readonly string[],
): Promise<MediaRefResult> {
  const origin = urlScheme(url);
  const refuse = (reason: MediaRefRejection, status?: number): MediaRefResult =>
    Object.freeze({ ok: false as const, reason, ...origin, ...(status !== undefined ? { status } : {}) });
  if (origin.scheme !== 'https') return refuse('scheme_unsupported');
  try {
    const result = await fetchPublicMediaBytes(url, {
      maxBytes,
      ...(signal ? { signal } : {}),
      ...(allowedDomains.length ? { allowedDomains } : {}),
      ...(trustedOrigins.length ? { trustedOrigins } : {}),
      ...(transport ? { transport } : {}),
    });
    if (!result.ok) {
      if (result.code === 'too_large') return refuse('too_large');
      if (result.code === 'http_status') return refuse('fetch_failed', result.status);
      if (result.code === 'failed') return refuse('fetch_failed', result.status);
      // `blocked`: private / loopback target, non-default port, domain not allowed or a refused redirect hop.
      return refuse('host_not_allowed');
    }
    const detected = inspectMediaBytes(result.bytes, expectedKind);
    if (!detected) return refuse('mime_mismatch');
    return { ok: true, payload: { kind: detected.kind, base64: result.bytes.toString('base64'), mimeType: detected.mimeType } };
  } catch {
    return refuse('fetch_failed');
  }
}

/**
 * canonical 媒体引用（SegmentMediaRef 形状）→ MediaBinaryPayload[]。
 * base64 直取；path 仅在 `authority.filesystem` 认可时读本地文件（不传 authority 不读，#1250）；
 * url 按需 fetch；kind=file（平台不透明引用）跳过。入站 path 由 `inbound-media` 按端点声明的目录单独判定。
 */
export async function normalizeMediaRefsToPayloads(
  refs: readonly { type: string; media: MediaRef }[],
  maxBytes: number,
  signal?: AbortSignal,
  authority?: OutboundMediaAuthority,
  transport: NetworkTransport | undefined = authority?.mediaTransport,
  /** #1250 第 48 批: the producing Endpoint's protocol-server origins, whose port a URL may keep. */
  trustedOrigins: readonly string[] = [],
): Promise<MediaBinaryPayload[]> {
  const results = await normalizeMediaRefs(refs, maxBytes, signal, authority, transport, trustedOrigins);
  return results.flatMap(result => result.ok ? [result.payload] : []);
}

/**
 * {@link normalizeMediaRefsToPayloads} with one result per ref (#1250 inbound-media-reject-reason-opaque,
 * ADR 0061 `media_rejected`): a refused or failed ref says why, with the scheme and URL host (never the
 * path, query string or data).
 */
export async function normalizeMediaRefs(
  refs: readonly { type: string; media: MediaRef }[],
  maxBytes: number,
  signal?: AbortSignal,
  authority?: OutboundMediaAuthority,
  transport: NetworkTransport | undefined = authority?.mediaTransport,
  trustedOrigins: readonly string[] = [],
): Promise<MediaRefResult[]> {
  const out: MediaRefResult[] = [];
  for (const { type, media } of refs) {
    signal?.throwIfAborted();
    out.push(await normalizeMediaRef(type, media, maxBytes, signal, authority, transport, trustedOrigins));
  }
  return out;
}

async function normalizeMediaRef(
  type: string,
  media: MediaRef,
  maxBytes: number,
  signal: AbortSignal | undefined,
  authority: OutboundMediaAuthority | undefined,
  transport: NetworkTransport | undefined,
  trustedOrigins: readonly string[],
): Promise<MediaRefResult> {
  const scheme = !media ? 'invalid' : media.kind === 'file' ? 'platform' : media.kind === 'url' ? urlScheme(media.value).scheme : media.kind;
  const refuse = (reason: MediaRefRejection, origin: Readonly<{ scheme: string; host?: string }> = { scheme }): MediaRefResult =>
    Object.freeze({ ok: false as const, reason, ...origin });
  if (!media || media.kind === 'file') return refuse('unmaterialized_platform_reference');
  if (typeof media.size === 'number' && media.size > maxBytes) {
    return refuse('too_large', media.kind === 'url' ? urlScheme(media.value) : { scheme });
  }
  const wantKind = kindFromSegmentType(type);
  const fileName = media.file_name ? { fileName: media.file_name } : {};

  if (media.kind === 'base64') {
    const dataUri = parseDataUri(media.value);
    const base64 = (dataUri?.base64 ?? media.value).replace(/^base64:\/\//, '');
    const decoded = decodeBase64Detailed(base64, maxBytes);
    if (!decoded.ok) return refuse(decoded.reason);
    const detected = inspectMediaBytes(decoded.bytes, wantKind ?? undefined);
    if (!detected) return refuse('mime_mismatch');
    return { ok: true, payload: { kind: detected.kind, base64: decoded.bytes.toString('base64'), mimeType: detected.mimeType, ...fileName } };
  }

  if (media.kind === 'path') {
    const authorized = await authorizeOutboundMediaPath(media.value, authority);
    if (!authorized) return refuse('path_not_allowed');
    const local = await readLocalMedia(authorized, maxBytes, wantKind ?? undefined);
    return local.ok ? { ok: true, payload: { ...local.payload, ...fileName } } : refuse(local.reason);
  }

  const origin = urlScheme(media.value);
  if (origin.scheme !== 'https') return refuse('scheme_unsupported', origin);
  const network = authorizeOutboundMediaUrl(media.value, authority);
  if (!network) return refuse('host_not_allowed', origin);
  const fetched = await fetchUrlMedia(media.value, maxBytes, wantKind ?? undefined, signal, network.allowedDomains, transport, trustedOrigins);
  return fetched.ok ? { ok: true, payload: { ...fetched.payload, ...fileName } } : fetched;
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
