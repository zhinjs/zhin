/**
 * HTTP(S) transport that connects only to an address it has checked (DNS pinning).
 *
 * The name is resolved once, every address must be public, and the socket connects to the address
 * that was checked — the request never resolves the name again, so DNS rebinding cannot swap in a
 * private address between the check and the connection. TLS still verifies the certificate against
 * the original host name (SNI + `Host`).
 *
 * Moved from `@zhin.js/agent` (`security/turn-network-client.ts`, which re-exports it) so the IM core
 * and adapters share one implementation (#1250 第 46 批).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
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
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await this.#lookup(host);
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

function requestPinnedAddress(
  url: URL,
  address: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Omit<NetworkBinaryResponse, 'url'>> {
  const requester = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = requester.request({
      protocol: url.protocol,
      hostname: address,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { ...headers, Host: url.host, 'Accept-Encoding': 'identity' },
      signal,
      ...(url.protocol === 'https:' && !isIP(bareUrlHost(url)) ? { servername: bareUrlHost(url) } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
          response.destroy(new Error(`Network response exceeds ${maxBytes} bytes`));
          return;
        }
        chunks.push(buffer);
      });
      response.once('error', reject);
      response.once('end', () => resolve(Object.freeze({
        status: response.statusCode ?? 0,
        statusText: response.statusMessage ?? '',
        headers: Object.freeze(normalizeHeaders(response.headers)),
        body: Buffer.concat(chunks),
      })));
    });
    request.once('error', reject);
    request.end();
  });
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).flatMap(([name, value]) => {
    if (value === undefined) return [];
    return [[name.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]];
  }));
}
