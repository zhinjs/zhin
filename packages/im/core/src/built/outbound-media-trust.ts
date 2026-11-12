/**
 * Outbound media policy for content from untrusted sources (ADR 0056 §2: reading host files is a
 * host-global capability).
 *
 * Adapter codecs read and upload `MediaRef kind: 'path'`, and several hand a `file` token or a
 * non-http URL straight to the platform SDK (OneBot reads `file://…` and bare paths from the host).
 * Content produced by an Agent model, or built from values a user controls, must therefore not be
 * able to name a host file. Core applies this policy once, in the renderer, before outbound
 * middleware and the Endpoint see the payload — no adapter repeats it and no parallel send path
 * exists (CLAUDE.md Guardrail #1).
 *
 * Untrusted media may only be:
 * - `url` with an `http:` / `https:` URL, or a base64 `data:` URL within the inline limit;
 * - `base64` within the inline limit;
 * - `file` that is a bare platform token (no scheme, no path separator, not `~` / `.`-relative);
 * - `path` (or a `file:` URL) that `trust.authorizePath` admits — the sender's own file policy,
 *   e.g. the Agent Turn's workspace authority plus FilePolicy — or a MediaRef that trusted code
 *   built with {@link trustedMediaRef} (e.g. bytes the Agent itself spooled to a temp file).
 *
 * A refused segment is replaced by a visible notice and logged (`op: outbound_media_refused`);
 * it is never sent silently and never sent as is.
 */
import { fileURLToPath } from 'node:url';
import type { Locale } from '@zhin.js/plugin-runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ConversationRef } from '@zhin.js/im-contract';
import { isMediaRef } from './segment-contract/validate.js';
import type { MediaRef, Segment } from './segment-contract/types.js';
import { toCanonicalSegments } from './generic-segment-mapper.js';
import { htmlToPlainText } from './html-to-text.js';

/** Same ceiling as the Agent's attachment limit (25 MiB of decoded bytes). */
export const DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES = 26_214_400;

export type OutboundMediaRefusal =
  | 'url_scheme'
  | 'inline_too_large'
  | 'inline_invalid'
  | 'host_path'
  | 'platform_ref_path'
  | 'nested_media'
  | 'raw_payload';

export interface OutboundMediaTrust {
  /** Short source label for logs, e.g. `agent:reply`. Never a user value. */
  readonly source: string;
  /**
   * Admit one local path (already decoded from a `file:` URL): return the canonical path that may be
   * sent, or `undefined` to refuse. Absent: every untrusted local path is refused.
   */
  readonly authorizePath?: (path: string) => Promise<string | undefined> | string | undefined;
  /** Inline (`base64` / `data:`) limit in decoded bytes; defaults to {@link DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES}. */
  readonly maxInlineBytes?: number;
  /** Language of the visible refusal notice. */
  readonly locale?: Locale;
}

export type UntrustedMediaDecision =
  | Readonly<{ allowed: true; media: MediaRef }>
  | Readonly<{ allowed: false; reason: OutboundMediaRefusal }>;

const trustedRefs = new WeakSet<object>();

/**
 * Mark a MediaRef that trusted code constructed (not copied from model output) so it passes the
 * untrusted-source policy unchanged. Identity-based: a copy of the object is not trusted.
 */
export function trustedMediaRef<T extends MediaRef>(media: T): T {
  trustedRefs.add(media);
  return media;
}

export function isTrustedMediaRef(media: unknown): boolean {
  return typeof media === 'object' && media !== null && trustedRefs.has(media);
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const BASE64_BODY = /^[A-Za-z0-9+/_-]*={0,2}$/u;

/** A platform file token, not something an SDK would resolve against the host filesystem. */
export function isPlatformFileToken(value: string): boolean {
  const token = value.trim();
  if (!token || token !== value || [...token].some(char => char.charCodeAt(0) < 0x20)) return false;
  if (SCHEME.test(token)) return false; // file:, data:, other schemes, Windows drives (C:)
  if (/[\\/]/u.test(token)) return false;
  return !token.startsWith('~') && !token.startsWith('.');
}

function inlineWithinLimit(body: string, maxBytes: number): UntrustedMediaDecision | undefined {
  const compact = body.replace(/\s+/gu, '');
  if (!BASE64_BODY.test(compact)) return { allowed: false, reason: 'inline_invalid' };
  if (Math.floor((compact.length * 3) / 4) > maxBytes) return { allowed: false, reason: 'inline_too_large' };
  return undefined;
}

/** Decide one MediaRef from an untrusted source. */
export async function checkUntrustedMediaRef(media: MediaRef, trust: OutboundMediaTrust): Promise<UntrustedMediaDecision> {
  if (isTrustedMediaRef(media)) return { allowed: true, media };
  const maxBytes = trust.maxInlineBytes ?? DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES;
  const value = media.value;
  switch (media.kind) {
    case 'url': {
      let url: URL;
      try { url = new URL(value); } catch { return { allowed: false, reason: 'url_scheme' }; }
      if (url.protocol === 'http:' || url.protocol === 'https:') return { allowed: true, media };
      if (url.protocol === 'data:') {
        const match = /^data:[^,]*;base64,([\s\S]*)$/iu.exec(value);
        if (!match) return { allowed: false, reason: 'inline_invalid' };
        return inlineWithinLimit(match[1]!, maxBytes) ?? { allowed: true, media };
      }
      return { allowed: false, reason: 'url_scheme' };
    }
    case 'base64': {
      const body = value.replace(/^base64:\/\//u, '').replace(/^data:[^,]*;base64,/iu, '');
      return inlineWithinLimit(body, maxBytes) ?? { allowed: true, media };
    }
    case 'file':
      return isPlatformFileToken(value) ? { allowed: true, media } : { allowed: false, reason: 'platform_ref_path' };
    case 'path': {
      if (!trust.authorizePath) return { allowed: false, reason: 'host_path' };
      let local = value;
      if (/^file:/iu.test(local)) {
        try { local = fileURLToPath(local); } catch { return { allowed: false, reason: 'host_path' }; }
      }
      if (!local.trim() || local.includes('\u0000')) return { allowed: false, reason: 'host_path' };
      let canonical: string | undefined;
      try { canonical = await trust.authorizePath(local); } catch { canonical = undefined; }
      if (typeof canonical !== 'string' || !canonical) return { allowed: false, reason: 'host_path' };
      return { allowed: true, media: trustedMediaRef({ ...media, value: canonical }) };
    }
    default:
      return { allowed: false, reason: 'host_path' };
  }
}

const MEDIA_SEGMENT_TYPES = new Set(['image', 'audio', 'video', 'file']);
/** Wire field names adapters read as a media source inside extension / nested segments. */
const MEDIA_SOURCE_KEYS = new Set(['file', 'path', 'url', 'src', 'image', 'thumb', 'audio', 'video', 'file_path']);
const MAX_NESTED_DEPTH = 8;

/** Media nested inside another segment (forward nodes, extension payloads, platform fields). */
async function nestedMediaAllowed(value: unknown, trust: OutboundMediaTrust, wireFields: boolean, depth = 0): Promise<boolean> {
  if (depth > MAX_NESTED_DEPTH) return false;
  if (Array.isArray(value)) {
    for (const item of value) if (!await nestedMediaAllowed(item, trust, wireFields, depth + 1)) return false;
    return true;
  }
  if (!value || typeof value !== 'object') return true;
  if (isMediaRef(value)) {
    if (isTrustedMediaRef(value)) return true;
    // A nested ref cannot be rewritten to its authorized canonical path: untrusted local paths never pass.
    return (await checkUntrustedMediaRef(value, { ...trust, authorizePath: undefined })).allowed;
  }
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (typeof field === 'string') {
      if (wireFields && MEDIA_SOURCE_KEYS.has(key) && field && !isRemoteSourceString(field)) return false;
      continue;
    }
    if (!await nestedMediaAllowed(field, trust, wireFields, depth + 1)) return false;
  }
  return true;
}

/** Canonical types whose fields are never read as a media source (links and button URLs may use any scheme). */
const NON_MEDIA_TYPES = new Set(['text', 'mention', 'markdown', 'keyboard', 'link', 'share', 'reply', 'face', 'dice', 'rps', 'reaction', 'action']);

function isRemoteSourceString(value: string): boolean {
  return /^https?:\/\//iu.test(value) || /^base64:\/\//iu.test(value) || isPlatformFileToken(value);
}

const NOTICE: Readonly<Record<'zh-CN' | 'en', { readonly labels: Readonly<Record<string, string>>; readonly text: (label: string) => string }>> = {
  'zh-CN': {
    labels: { image: '图片', audio: '语音', video: '视频', file: '文件' },
    text: label => `[${label}未发送：媒体来源不被允许]`,
  },
  en: {
    labels: { image: 'image', audio: 'audio', video: 'video', file: 'file' },
    text: label => `[${label} not sent: media source not allowed]`,
  },
};

function refusalNotice(type: string, locale: Locale | undefined): Segment {
  const notice = locale === 'en' ? NOTICE.en : NOTICE['zh-CN'];
  return { type: 'text', data: { text: notice.text(notice.labels[type] ?? (locale === 'en' ? 'attachment' : '附件')) } };
}

const logger = getLogger('im.outbound');

export interface UntrustedOutboundContext {
  readonly requester?: string;
  readonly conversation?: ConversationRef;
}

function logRefusal(trust: OutboundMediaTrust, context: UntrustedOutboundContext, segment: string, kind: string | undefined, reason: OutboundMediaRefusal): void {
  // Never log the media value: it is model / user controlled and may itself be the secret path.
  logger.warn(formatCompact({
    op: 'outbound_media_refused',
    source: trust.source,
    segment,
    ...(kind ? { kind } : {}),
    reason,
    ...(context.requester ? { requester: context.requester } : {}),
    ...(context.conversation ? { conv: `${context.conversation.endpoint.id}/${context.conversation.kind}:${context.conversation.id}` } : {}),
  }));
}

/**
 * Hold rendered untrusted content to the policy. Strings stay text; segments are canonicalized first
 * (legacy `{ file }` / `{ path }` fields become `data.media`), `html` is reduced to text (a renderer
 * could load local files), raw native payloads are refused.
 */
export async function enforceUntrustedOutbound(
  rendered: unknown,
  trust: OutboundMediaTrust,
  context: UntrustedOutboundContext = {},
): Promise<unknown[]> {
  const items = Array.isArray(rendered) ? rendered : [rendered];
  const out: unknown[] = [];
  for (const item of items) {
    if (item == null) continue;
    if (typeof item === 'string') { out.push(item); continue; }
    if (typeof item !== 'object' || Array.isArray(item) || typeof (item as { type?: unknown }).type !== 'string') {
      logRefusal(trust, context, 'raw', undefined, 'raw_payload');
      out.push(refusalNotice('raw', trust.locale));
      continue;
    }
    const [segment] = toCanonicalSegments([item]);
    if (!segment) continue;
    if (segment.type === 'html') {
      const data = segment.data as Record<string, unknown>;
      const text = typeof data.text === 'string' && data.text ? data.text
        : typeof data.html === 'string' ? htmlToPlainText(data.html) : '';
      out.push({ type: 'text', data: { text } });
      continue;
    }
    const data = (segment.data ?? {}) as Record<string, unknown>;
    const media = data.media;
    if (MEDIA_SEGMENT_TYPES.has(segment.type) && isMediaRef(media)) {
      const decision = await checkUntrustedMediaRef(media, trust);
      if (!decision.allowed) {
        logRefusal(trust, context, segment.type, media.kind, decision.reason);
        out.push(refusalNotice(segment.type, trust.locale));
        continue;
      }
      const platformOk = await nestedMediaAllowed(segment.platform, trust, true);
      if (!platformOk) {
        logRefusal(trust, context, segment.type, media.kind, 'nested_media');
        out.push(refusalNotice(segment.type, trust.locale));
        continue;
      }
      out.push(decision.media === media ? segment : { ...segment, data: { ...data, media: decision.media } });
      continue;
    }
    const wireFields = !NON_MEDIA_TYPES.has(segment.type);
    if (!await nestedMediaAllowed(segment.data, trust, wireFields) || !await nestedMediaAllowed(segment.platform, trust, true)) {
      logRefusal(trust, context, segment.type, undefined, 'nested_media');
      out.push(refusalNotice(segment.type, trust.locale));
      continue;
    }
    out.push(segment);
  }
  return out;
}
