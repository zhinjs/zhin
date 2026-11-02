import { lookup } from 'node:dns/promises';
import { NETWORK_DISABLED_REASON } from './network-authority.js';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import type { ToolInvocationPolicy } from '@zhin.js/tool';
import {
  checkUrlNetworkAccess,
  isBlockedSsrfHostname,
  NetworkAccessDeniedError,
} from './network-policy.js';

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

export interface NetworkRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  readonly maxBytes?: number;
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

/** One policy-authorized hop; credentials may narrow when its redirect changes origin. */
interface AuthorizedNetworkHop {
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxBytes: number;
}

/** Turn-scoped network module: policy, DNS pinning, redirects, timeout, and body limits. */
export class TurnNetworkClient {
  constructor(
    private readonly policy: ToolInvocationPolicy,
    private readonly signal: AbortSignal,
    private readonly transport: NetworkTransport = new NodeNetworkTransport(),
  ) {}

  async getText(url: string, options: NetworkRequestOptions = {}): Promise<NetworkTextResponse> {
    return this.#get(url, options, hop => this.transport.request(hop.url, hop.headers, hop.signal, hop.maxBytes));
  }

  async getBytes(url: string, options: NetworkRequestOptions = {}): Promise<NetworkBinaryResponse> {
    const request = this.transport.requestBytes;
    if (!request) throw new Error('This network transport does not support binary media');
    return this.#get(url, options, hop => request.call(this.transport, hop.url, hop.headers, hop.signal, hop.maxBytes));
  }

  async #get<T extends Omit<NetworkTextResponse, 'body' | 'url'> & { readonly body: string | Uint8Array }>(
    url: string,
    options: NetworkRequestOptions,
    request: (hop: AuthorizedNetworkHop) => Promise<T>,
  ): Promise<T & { readonly url: string }> {
    const maxRedirects = options.maxRedirects ?? 5;
    const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(timeoutMs)]);
    let current = url;
    let headers = options.headers ?? {};

    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      signal.throwIfAborted();
      const parsed = authorizeNetworkUrl(current, this.policy);
      const response = await request({ url: parsed, headers, signal, maxBytes });
      if (response.status < 300 || response.status >= 400) {
        return Object.freeze({ url: parsed.href, ...response });
      }
      const location = response.headers.location;
      if (!location) return Object.freeze({ url: parsed.href, ...response });
      if (redirect === maxRedirects) {
        throw new NetworkAccessDeniedError(`Network redirect limit exceeded (${maxRedirects})`);
      }
      const next = new URL(location, parsed);
      if (next.origin !== parsed.origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) =>
          !/^(?:authorization|cookie|proxy-authorization)$/iu.test(name)));
      }
      current = next.href;
    }
    throw new NetworkAccessDeniedError('Network redirect state is invalid');
  }
}

export class NodeNetworkTransport implements NetworkTransport {
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
    const addresses = isIP(url.hostname)
      ? [{ address: url.hostname, family: isIP(url.hostname) }]
      : await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0) throw new Error(`DNS returned no address for ${url.hostname}`);
    for (const entry of addresses) {
      if (isBlockedSsrfHostname(entry.address)) {
        throw new NetworkAccessDeniedError(`DNS target ${entry.address} for ${url.hostname} is private or dangerous`);
      }
    }
    const selected = addresses[0]!;
    return requestPinnedAddress(url, selected.address, headers, signal, maxBytes);
  }
}

export function authorizeNetworkUrl(url: string, policy: ToolInvocationPolicy): URL {
  if (!policy.network.enabled) {
    throw new NetworkAccessDeniedError(NETWORK_DISABLED_REASON);
  }
  const decision = checkUrlNetworkAccess(url, {
    httpsOnly: policy.network.httpsOnly,
    allowedDomains: [...(policy.network.allowedDomains ?? [])],
  });
  if (!decision.allowed) throw new NetworkAccessDeniedError(decision.reason ?? 'Network target denied');
  return new URL(url);
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
      ...(url.protocol === 'https:' && !isIP(url.hostname) ? { servername: url.hostname } : {}),
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
