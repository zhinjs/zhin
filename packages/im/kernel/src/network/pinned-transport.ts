/**
 * HTTP(S) transport that connects only to an address it has checked (DNS pinning).
 *
 * The name is resolved once, every address must be public, and the socket connects to the address
 * that was checked — the request never resolves the name again, so DNS rebinding cannot swap in a
 * private address between the check and the connection. TLS still verifies the certificate against
 * the original host name (SNI + `Host`).
 *
 * Moved from `@zhin.js/agent` (`security/turn-network-client.ts`, which re-exports it) so the IM core
 * and adapters share one implementation (#1250 第 46 批). `node:http` / `node:https` are loaded on the
 * first request, not at import: the kernel is loaded by every instance, and a supervised instance must
 * not load the Node HTTP stack (ADR 0054 §2).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import type * as http from 'node:http';
import { isIP } from 'node:net';
import { isBlockedSsrfHostname, NetworkAccessDeniedError } from './ssrf.js';

export interface NetworkTextResponse {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}
/** Binary media uses the same authorized hops and pinned connection as text requests. */
export interface NetworkBinaryResponse extends Omit<NetworkTextResponse, 'body'> {
  readonly body: Uint8Array;
}

export interface NetworkTransport {
  request(
    url: URL,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<Omit<NetworkTextResponse, 'url'>>;
  requestBytes?(
    url: URL,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<Omit<NetworkBinaryResponse, 'url'>>;
}

export type NetworkAddressLookup = (host: string) => Promise<ReadonlyArray<{ readonly address: string; readonly family?: number }>>;
/** Send one GET to `address` (already checked) for `url`. */
export type PinnedAddressConnect = (
  url: URL,
  address: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<Omit<NetworkBinaryResponse, 'url'>>;

export interface NodeNetworkTransportOptions {
  /** Replaces the system resolver (tests). */
  readonly lookup?: NetworkAddressLookup;
  /** Replaces the pinned Node request (tests). */
  readonly connect?: PinnedAddressConnect;
}

const systemLookup: NetworkAddressLookup = host => dnsLookup(host, { all: true, verbatim: true });

export class NodeNetworkTransport implements NetworkTransport {
  readonly #lookup: NetworkAddressLookup;
  readonly #connect: PinnedAddressConnect;

  constructor(options: NodeNetworkTransportOptions = {}) {
    this.#lookup = options.lookup ?? systemLookup;
    this.#connect = options.connect ?? requestPinnedAddress;
  }

  async request(
    url: URL,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<Omit<NetworkTextResponse, 'url'>> {
    const response = await this.requestBytes(url, headers, signal, maxBytes);
    return Object.freeze({ ...response, body: Buffer.from(response.body).toString('utf8') });
  }

  async requestBytes(
    url: URL,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<Omit<NetworkBinaryResponse, 'url'>> {
    const host = bareUrlHost(url);
    signal.throwIfAborted();
    // A resolver that answers slowly on purpose must not outlive the caller's deadline (#1250 第 46 批 L1).
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await raceAbort(this.#lookup(host), signal);
    if (addresses.length === 0) throw new Error(`DNS returned no address for ${url.hostname}`);
    for (const entry of addresses) {
      if (isBlockedSsrfHostname(entry.address)) {
        throw new NetworkAccessDeniedError(`DNS target ${entry.address} for ${url.hostname} is private or dangerous`);
      }
    }
    const selected = addresses[0]!;
    return this.#connect(url, selected.address, headers, signal, maxBytes);
  }
}

/** `URL.hostname` keeps the brackets of an IPv6 literal; `isIP`, DNS and SNI need the bare address. */
export function bareUrlHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/** SNI carries a host name without the trailing root dot (RFC 6066 §3); `media.example.` → `media.example`. */
function sniHostName(url: URL): string | undefined {
  const host = bareUrlHost(url);
  if (isIP(host)) return undefined;
  const name = host.replace(/\.+$/u, '');
  return name || undefined;
}

/** Settle with `promise`, or reject as soon as `signal` aborts (the work itself may keep running). */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The operation was aborted');
}

/**
 * TLS settings for the pinned request. Internal (not exported from the package root): tests pass the
 * certificate of a local server as `ca`; production always uses the default trust store.
 */
export interface PinnedAddressTlsOptions {
  readonly ca?: string | Buffer;
}

/**
 * The pinned Node request: connects to `address` (already checked), sends `Host` and SNI for the URL's
 * host name so TLS still verifies the certificate against that name. Internal; exported from this
 * module for the kernel / agent integration tests only.
 */
export function createPinnedAddressConnect(tls: PinnedAddressTlsOptions = {}): PinnedAddressConnect {
  return async (url, address, headers, signal, maxBytes) => {
    signal.throwIfAborted();
    const send = (url.protocol === 'https:' ? (await import('node:https')).request : (await import('node:http')).request) as typeof http.request;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
        // Stop reading and drop the connection; the promise is already settled.
        try {
          request.destroy();
        } catch {
          // already destroyed
        }
      };
      const onAbort = () => fail(abortReason(signal));
      const servername = url.protocol === 'https:' ? sniHostName(url) : undefined;
      const request = send({
        protocol: url.protocol,
        hostname: address,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { ...headers, Host: url.host, 'Accept-Encoding': 'identity' },
        signal,
        ...(servername ? { servername } : {}),
        ...(tls.ca !== undefined ? { ca: tls.ca } : {}),
      }, (response) => {
        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          fail(new Error(`Network response exceeds ${maxBytes} bytes`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > maxBytes) {
            fail(new Error(`Network response exceeds ${maxBytes} bytes`));
            return;
          }
          chunks.push(buffer);
        });
        response.once('error', fail);
        response.once('aborted', () => fail(new Error('Network response ended before the declared length')));
        response.once('end', () => {
          if (settled) return;
          // A body shorter than its Content-Length is a truncated download, not media.
          if (response.complete === false || (Number.isFinite(declared) && size !== declared)) {
            fail(new Error('Network response ended before the declared length'));
            return;
          }
          settled = true;
          signal.removeEventListener('abort', onAbort);
          resolve(Object.freeze({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: Object.freeze(normalizeHeaders(response.headers)),
            body: Buffer.concat(chunks),
          }));
        });
      });
      signal.addEventListener('abort', onAbort, { once: true });
      request.once('error', fail);
      request.end();
    });
  };
}

/** The production pinned request (default trust store). Internal; see {@link createPinnedAddressConnect}. */
export const requestPinnedAddress: PinnedAddressConnect = createPinnedAddressConnect();

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).flatMap(([name, value]) => {
    if (value === undefined) return [];
    return [[name.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]];
  }));
}
