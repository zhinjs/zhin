import { lookup } from 'node:dns/promises';
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
}

/** Turn-scoped network module: policy, DNS pinning, redirects, timeout, and body limits. */
export class TurnNetworkClient {
  constructor(
    private readonly policy: ToolInvocationPolicy,
    private readonly signal: AbortSignal,
    private readonly transport: NetworkTransport = new NodeNetworkTransport(),
  ) {}

  async getText(url: string, options: NetworkRequestOptions = {}): Promise<NetworkTextResponse> {
    const maxRedirects = options.maxRedirects ?? 5;
    const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(timeoutMs)]);
    let current = url;

    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      signal.throwIfAborted();
      const parsed = authorizeNetworkUrl(current, this.policy);
      const response = await this.transport.request(parsed, options.headers ?? {}, signal, maxBytes);
      if (response.status < 300 || response.status >= 400) {
        return Object.freeze({ url: parsed.href, ...response });
      }
      const location = response.headers.location;
      if (!location) return Object.freeze({ url: parsed.href, ...response });
      if (redirect === maxRedirects) {
        throw new NetworkAccessDeniedError(`Network redirect limit exceeded (${maxRedirects})`);
      }
      current = new URL(location, parsed).href;
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
    throw new NetworkAccessDeniedError('Turn has no network authority');
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
): Promise<Omit<NetworkTextResponse, 'url'>> {
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
        body: Buffer.concat(chunks).toString('utf8'),
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
