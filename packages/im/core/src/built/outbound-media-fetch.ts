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
 * - port 443 only (written as `:443` or not) unless `allowedPorts` lists more, on every redirect hop
 *   too: any other port is refused as `outbound_media_url_blocked` with `reason: 'port'` (#1250 第 48 批);
 * - the name is resolved once, every address must be public, and the connection goes to the address
 *   that was checked (DNS pinning — no rebinding between check and connect);
 * - redirects are followed by hand and every hop is checked again;
 * - the body is capped (`maxBytes`, default {@link DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES}) and the
 *   whole download — waiting for a slot and DNS included — is bounded by `timeoutMs` (default 30 s);
 * - at most {@link OUTBOUND_MEDIA_MAX_CONCURRENT} downloads run at once on this host; the rest wait
 *   in order, and a waiting request still honours its signal and deadline.
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
/** Downloads that may run at once on this host, across every adapter (#1250 第 46 批 L1). */
export const OUTBOUND_MEDIA_MAX_CONCURRENT = 8;

/** FIFO slots; a waiter whose signal aborts leaves the queue and rejects with the signal's reason. */
class DownloadSlots {
  #active = 0;
  readonly #waiting: Array<{ readonly grant: () => void }> = [];

  constructor(readonly limit: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.#active < this.limit) {
      this.#active += 1;
      return this.#releaser();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        grant: () => {
          signal.removeEventListener('abort', onAbort);
          this.#active += 1;
          resolve();
        },
      };
      const onAbort = () => {
        const index = this.#waiting.indexOf(waiter);
        if (index >= 0) this.#waiting.splice(index, 1);
        reject(signal.reason ?? new Error('The operation was aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#waiting.push(waiter);
    });
    return this.#releaser();
  }

  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      this.#waiting.shift()?.grant();
    };
  }
}

const sharedSlots = new DownloadSlots(OUTBOUND_MEDIA_MAX_CONCURRENT);

/**
 * - `outbound_media_url_blocked`: not a public HTTPS target on an allowed port (scheme, host, port, resolved
 *   address or a redirect hop);
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
  /** Why an address was refused, when more specific than the code: `port` (not 443 / `allowedPorts`). */
  readonly reason?: 'port';

  readonly #refused: boolean;

  constructor(
    code: OutboundMediaFetchCode,
    details: { readonly host?: string; readonly status?: number; readonly refused?: boolean; readonly reason?: 'port' } = {},
  ) {
    super(`${code}${details.host ? ` (${details.host})` : ''}${details.reason ? ` reason=${details.reason}` : ''}${details.status !== undefined ? ` HTTP ${details.status}` : ''}`);
    this.name = 'OutboundMediaFetchError';
    this.code = code;
    if (details.host) this.host = details.host;
    if (details.status !== undefined) this.status = details.status;
    if (details.reason) this.reason = details.reason;
    this.#refused = details.refused
      ?? (code === 'outbound_media_url_blocked' || code === 'outbound_media_too_large');
  }

  /**
   * Refused by policy (address or size): replace the media with a notice and send the rest. An
   * oversize body in a `probe` download is not a refusal (the server ignored `Range`).
   */
  get refused(): boolean {
    return this.#refused;
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
  /**
   * Ports accepted besides 443, on every hop (default none). Only for a platform whose own media host
   * is known to use another port; never from user or model input.
   */
  readonly allowedPorts?: readonly number[];
  /**
   * A best-effort read of the first `maxBytes` (e.g. an image-size probe with `Range`). A body over
   * `maxBytes` — a server that ignored `Range` and sent the whole file — is then an ordinary failure:
   * `outbound_media_too_large` with `refused === false`, logged at debug instead of warn. Address
   * refusals are unchanged.
   */
  readonly probe?: boolean;
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
  /**
   * Downloads this fetcher may run at once. Omitted: the host-wide limit
   * ({@link OUTBOUND_MEDIA_MAX_CONCURRENT}, shared with every other fetcher that omits it).
   */
  readonly maxConcurrent?: number;
}

const logger = getLogger('im.outbound');

export function createOutboundMediaFetcher(options: OutboundMediaFetcherOptions = {}): OutboundMediaFetcher {
  const transport = options.transport ?? (options.lookup || options.connect
    ? new NodeNetworkTransport({
      ...(options.lookup ? { lookup: options.lookup } : {}),
      ...(options.connect ? { connect: options.connect } : {}),
    })
    : undefined);
  const slots = options.maxConcurrent !== undefined
    ? new DownloadSlots(Math.max(1, Math.floor(options.maxConcurrent)))
    : sharedSlots;
  return async (url, fetchOptions = {}) => {
    fetchOptions.signal?.throwIfAborted();
    const timeoutMs = fetchOptions.timeoutMs ?? OUTBOUND_MEDIA_FETCH_TIMEOUT_MS;
    // One deadline for the wait in the queue and the download itself.
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = fetchOptions.signal ? AbortSignal.any([fetchOptions.signal, deadline]) : deadline;
    let release: () => void;
    try {
      release = await slots.acquire(signal);
    } catch (error) {
      fetchOptions.signal?.throwIfAborted();
      if (deadline.aborted) throw new OutboundMediaFetchError('outbound_media_fetch_failed', hostDetails(url));
      throw error;
    }
    let result: Awaited<ReturnType<typeof fetchPublicMediaBytes>>;
    try {
      result = await fetchPublicMediaBytes(url, {
        maxBytes: fetchOptions.maxBytes ?? DEFAULT_UNTRUSTED_INLINE_MEDIA_BYTES,
        timeoutMs,
        signal,
        ...(fetchOptions.headers ? { headers: fetchOptions.headers } : {}),
        ...(fetchOptions.allowedPorts?.length ? { allowedPorts: fetchOptions.allowedPorts } : {}),
        ...(transport ? { transport } : {}),
      });
    } finally {
      release();
    }
    if (result.ok) {
      return Object.freeze({ bytes: result.bytes, ...(result.mimeType ? { mimeType: result.mimeType } : {}), url: result.url });
    }
    // A caller cancellation stays a cancellation, not a media failure.
    fetchOptions.signal?.throwIfAborted();
    const probeOversize = fetchOptions.probe === true && result.code === 'too_large';
    const error = new OutboundMediaFetchError(CODES[result.code], {
      ...(result.host ? { host: result.host } : {}),
      ...(result.status !== undefined ? { status: result.status } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(probeOversize ? { refused: false } : {}),
    });
    const line = formatCompact({
      op: error.code,
      ...(fetchOptions.source ? { source: fetchOptions.source } : {}),
      ...(error.host ? { host: error.host } : {}),
      ...(error.reason ? { reason: error.reason } : {}),
    });
    if (error.refused) logger.warn(line);
    else if (probeOversize) logger.debug(line);
    throw error;
  };
}

function hostDetails(url: string): { readonly host?: string } {
  try {
    const host = new URL(url).hostname;
    return host ? { host } : {};
  } catch {
    return {};
  }
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
