/**
 * The one way an adapter downloads an outbound media URL on this host (#1250 第 46 批).
 *
 * Several adapters cannot hand a URL to their platform: they download it here and upload the bytes
 * (Lark / WeCom / WeChat MP media upload, KOOK cards, Slack files, Discord and e-mail attachments, …).
 * An adapter cannot tell where a MediaRef came from — Agent replies carry model-chosen URLs, and the
 * untrusted-source policy (`outbound-media-trust.ts`) admits every http(s) URL because most platforms
 * fetch it on their own servers. A URL downloaded *here* is therefore always treated as untrusted:
 *
 * - HTTPS only; private, loopback, link-local and metadata hosts are refused by name;
 * - the name is resolved once, every address must be public, and the connection goes to the address
 *   that was checked (DNS pinning — no rebinding between check and connect);
 * - redirects are followed by hand and every hop is checked again;
 * - the body is capped (`maxBytes`, default {@link DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES}) and the
 *   whole download is bounded by `timeoutMs` (default 30 s).
 *
 * A refused URL throws {@link OutboundMediaFetchError} with `refused === true`; the adapter replaces
 * that media with {@link outboundMediaNotice} and still sends the rest of the message. The refusal is
 * logged once here (`op: outbound_media_url_blocked`) with the host name only, never the full URL.
 *
 * URLs an adapter hands to its platform unchanged (the platform's servers download them) do not go
 * through this module.
 */
import {
  fetchPublicMediaBytes,
  NodeNetworkTransport,
  type NetworkAddressLookup,
  type NetworkTransport,
  type PinnedAddressConnect,
} from '@zhin.js/kernel';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { Locale } from '@zhin.js/plugin-runtime';
import { DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES } from './outbound-media-trust.js';

export const OUTBOUND_MEDIA_FETCH_TIMEOUT_MS = 30_000;

/**
 * - `outbound_media_url_blocked`: not a public HTTPS target (scheme, host, resolved address or a redirect hop);
 * - `outbound_media_too_large`: the body exceeds `maxBytes`;
 * - `outbound_media_http_status`: the final response is not 2xx;
 * - `outbound_media_fetch_failed`: timeout, connection / TLS error, too many redirects.
 */
export type OutboundMediaFetchCode =
  | 'outbound_media_url_blocked'
  | 'outbound_media_too_large'
  | 'outbound_media_http_status'
  | 'outbound_media_fetch_failed';

const CODES = {
  blocked: 'outbound_media_url_blocked',
  too_large: 'outbound_media_too_large',
  http_status: 'outbound_media_http_status',
  failed: 'outbound_media_fetch_failed',
} as const satisfies Record<string, OutboundMediaFetchCode>;

export class OutboundMediaFetchError extends Error {
  readonly code: OutboundMediaFetchCode;
  /** Host of the refused or failed hop; never the full URL. */
  readonly host?: string;
  readonly status?: number;

  constructor(code: OutboundMediaFetchCode, details: { readonly host?: string; readonly status?: number } = {}) {
    super(`${code}${details.host ? ` (${details.host})` : ''}${details.status !== undefined ? ` HTTP ${details.status}` : ''}`);
    this.name = 'OutboundMediaFetchError';
    this.code = code;
    if (details.host) this.host = details.host;
    if (details.status !== undefined) this.status = details.status;
  }

  /** Refused by policy (address or size): replace the media with a notice and send the rest. */
  get refused(): boolean {
    return this.code === 'outbound_media_url_blocked' || this.code === 'outbound_media_too_large';
  }
}

/** True when `error` is a policy refusal from {@link OutboundMediaFetcher} (see {@link OutboundMediaFetchError.refused}). */
export function isOutboundMediaRefused(error: unknown): error is OutboundMediaFetchError {
  return error instanceof OutboundMediaFetchError && error.refused;
}

export interface OutboundMediaFetchOptions {
  readonly signal?: AbortSignal;
  /** Body limit in bytes; defaults to {@link DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES}. */
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  /** Extra request headers (e.g. `Range`). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Short label for logs, e.g. the adapter name. Never a user value. */
  readonly source?: string;
}

export interface OutboundMediaFetched {
  readonly bytes: Buffer;
  /** `Content-Type` without parameters, when the server sent one. */
  readonly mimeType?: string;
  /** The final URL after redirects. */
  readonly url: string;
}

/** Download one outbound media URL on this host under the rules above; throws {@link OutboundMediaFetchError}. */
export type OutboundMediaFetcher = (url: string, options?: OutboundMediaFetchOptions) => Promise<OutboundMediaFetched>;

export interface OutboundMediaFetcherOptions {
  /** Replaces the pinned transport entirely (tests). */
  readonly transport?: NetworkTransport;
  /** Replaces the system resolver of the pinned transport (tests). */
  readonly lookup?: NetworkAddressLookup;
  /** Replaces the pinned request of the pinned transport (tests); it receives the checked address. */
  readonly connect?: PinnedAddressConnect;
}

const logger = getLogger('im.outbound');

export function createOutboundMediaFetcher(options: OutboundMediaFetcherOptions = {}): OutboundMediaFetcher {
  const transport = options.transport ?? (options.lookup || options.connect
    ? new NodeNetworkTransport({
      ...(options.lookup ? { lookup: options.lookup } : {}),
      ...(options.connect ? { connect: options.connect } : {}),
    })
    : undefined);
  return async (url, fetchOptions = {}) => {
    fetchOptions.signal?.throwIfAborted();
    const result = await fetchPublicMediaBytes(url, {
      maxBytes: fetchOptions.maxBytes ?? DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES,
      timeoutMs: fetchOptions.timeoutMs ?? OUTBOUND_MEDIA_FETCH_TIMEOUT_MS,
      ...(fetchOptions.signal ? { signal: fetchOptions.signal } : {}),
      ...(fetchOptions.headers ? { headers: fetchOptions.headers } : {}),
      ...(transport ? { transport } : {}),
    });
    if (result.ok) {
      return Object.freeze({ bytes: result.bytes, ...(result.mimeType ? { mimeType: result.mimeType } : {}), url: result.url });
    }
    // A caller cancellation stays a cancellation, not a media failure.
    fetchOptions.signal?.throwIfAborted();
    const error = new OutboundMediaFetchError(CODES[result.code], {
      ...(result.host ? { host: result.host } : {}),
      ...(result.status !== undefined ? { status: result.status } : {}),
    });
    if (error.refused) {
      logger.warn(formatCompact({
        op: error.code,
        ...(fetchOptions.source ? { source: fetchOptions.source } : {}),
        ...(error.host ? { host: error.host } : {}),
      }));
    }
    throw error;
  };
}

/** The default fetcher: pinned Node transport. Adapters use it unless a test injects another. */
export const fetchOutboundMedia: OutboundMediaFetcher = createOutboundMediaFetcher();

const NOTICE: Readonly<Record<'zh-CN' | 'en', { readonly labels: Readonly<Record<string, string>>; readonly fallback: string; readonly text: (label: string) => string }>> = {
  'zh-CN': {
    labels: { image: '图片', audio: '语音', record: '语音', video: '视频', file: '文件' },
    fallback: '附件',
    text: label => `[${label}未发送：媒体地址不被允许]`,
  },
  en: {
    labels: { image: 'image', audio: 'audio', record: 'audio', video: 'video', file: 'file' },
    fallback: 'attachment',
    text: label => `[${label} not sent: media address not allowed]`,
  },
};

/** Visible text that replaces a media segment whose URL was refused. */
export function outboundMediaNotice(segmentType: string, locale?: Locale): string {
  const notice = locale === 'en' ? NOTICE.en : NOTICE['zh-CN'];
  return notice.text(notice.labels[segmentType] ?? notice.fallback);
}
