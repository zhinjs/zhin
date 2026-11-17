/**
 * Outbound address policy for URLs that come from chat users or third-party pages (SSRF guard).
 *
 * This process connects to the target itself, so a URL is requested only when its host is a
 * public name and every address it resolves to is public. Redirects are followed by hand and
 * each hop is checked again. The connection goes to the address that was checked (the TLS name
 * and `Host` stay the URL's host), so a rebinding resolver cannot swap in a private address
 * between the check and the connection, and no environment proxy re-resolves the name.
 * Credentials (`Authorization`, `Cookie`) are not carried to another origin on redirect.
 *
 * Plugins may not depend on each other, so this small module is duplicated in the plugins that
 * fetch user-supplied URLs. Keep the copies identical.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

export class BlockedUrlError extends Error {
  readonly code = 'blocked_url';
  constructor(reason: string) {
    super(`refusing to fetch: ${reason}`);
    this.name = 'BlockedUrlError';
  }
}

const blockedV4 = new BlockList();
for (const [base, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedV4.addSubnet(base, bits, 'ipv4');
// Host-internal endpoints that sit in otherwise public space (Alibaba metadata, Azure WireServer).
for (const address of ['100.100.100.200', '168.63.129.16']) blockedV4.addAddress(address, 'ipv4');

// IPv6 is an allow-list: global unicast only, minus the special ranges inside it.
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [base, bits] of [
  ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blockedV6.addSubnet(base, bits, 'ipv6');
const mappedV4 = new BlockList();
mappedV4.addSubnet('::ffff:0:0', 96, 'ipv6');

/** True when a literal IP address is globally routable and not a known host-internal endpoint. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  if (family !== 6) return false;
  // BlockList matches IPv4 rules against IPv4-mapped IPv6 addresses.
  if (mappedV4.check(address, 'ipv6')) return !blockedV4.check(address, 'ipv6');
  return globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}

const BLOCKED_SUFFIXES = [
  'localhost', 'local', 'localdomain', 'internal', 'intranet', 'private', 'corp', 'home', 'lan',
  'arpa', 'test', 'invalid', 'example', 'onion', 'metadata.goog',
];

/** Resolves a host name to every address it maps to. */
export type HostLookup = (hostname: string) => Promise<readonly string[]>;

const systemLookup: HostLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/** A URL that passed the address policy and the address its connection must use. */
interface PublicTarget {
  readonly url: URL;
  /** Checked address to connect to; absent only when the operator allowed private networks. */
  readonly address?: string;
}

async function resolvePublicTarget(
  input: string | URL,
  lookup: HostLookup,
  allowPrivateNetwork: boolean,
): Promise<PublicTarget> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BlockedUrlError('not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('only http and https are allowed');
  if (url.username || url.password) throw new BlockedUrlError('credentials in the URL are not allowed');
  // Operator opt-in (never chat users): scheme and credential rules still apply, the address policy does not.
  if (allowPrivateNetwork) return { url };
  // The WHATWG parser already canonicalised odd IPv4 spellings (0x7f.1, 2130706433) to dotted quads.
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrlError(`${host} is not a public address`);
    return { url, address: host };
  }
  if (!host.includes('.') || BLOCKED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw new BlockedUrlError(`${host} is not a public host name`);
  }
  let addresses: readonly string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new BlockedUrlError(`${host} could not be resolved`);
  }
  if (addresses.length === 0) throw new BlockedUrlError(`${host} could not be resolved`);
  const internal = addresses.find((address) => !isPublicAddress(address));
  if (internal !== undefined) throw new BlockedUrlError(`${host} resolves to a non-public address`);
  return { url, address: addresses[0]! };
}

/**
 * Parse `input` and refuse anything that is not an http(s) URL on a public host.
 * Fails closed: an unresolvable name, or a name with any non-public address, is refused.
 */
export async function assertPublicUrl(
  input: string | URL,
  lookup: HostLookup = systemLookup,
  allowPrivateNetwork = false,
): Promise<URL> {
  return (await resolvePublicTarget(input, lookup, allowPrivateNetwork)).url;
}

export interface PinnedRequestInit {
  readonly method: 'GET' | 'HEAD';
  readonly headers: Headers;
}

/**
 * Sends one request for `url` to `address` (the checked address; `undefined` = resolve `url`'s
 * host normally, only with `allowPrivateNetwork`). Never follows redirects.
 */
export type PinnedRequest = (
  url: URL,
  address: string | undefined,
  init: PinnedRequestInit,
  signal: AbortSignal,
) => Promise<Response>;

export interface PublicFetchOptions {
  /** Bounds every hop and the body read of the returned response. */
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  /** Only GET or HEAD; the headers are sent to every same-origin hop. */
  readonly init?: { readonly method?: string; readonly headers?: HeadersInit };
  /** Extra per-hop rule on top of the address policy (for example a host allow-list). */
  readonly allow?: (url: URL) => boolean;
  readonly lookup?: HostLookup;
  /** Skip the public-address requirement. Only for an explicit operator setting; default false. */
  readonly allowPrivateNetwork?: boolean;
  /** Replaces the pinned Node connection (tests). */
  readonly request?: PinnedRequest;
}

export interface PublicResponse {
  readonly response: Response;
  /** URL of the hop that produced `response`. */
  readonly url: string;
}

const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

/** Fetch with redirects followed by hand so that every hop passes the address policy first. */
export async function fetchPublic(input: string, options: PublicFetchOptions = {}): Promise<PublicResponse> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const maxRedirects = options.maxRedirects ?? 5;
  const request = options.request ?? requestPinned;
  const method = (options.init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') throw new TypeError(`fetchPublic only sends GET or HEAD, not ${method}`);
  const headers = new Headers(options.init?.headers);
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const { url, address } = await resolvePublicTarget(current, options.lookup ?? systemLookup, options.allowPrivateNetwork ?? false);
    if (options.allow && !options.allow(url)) throw new BlockedUrlError(`${url.hostname} is outside the allow-list`);
    signal.throwIfAborted();
    const response = await request(url, address, { method, headers: new Headers(headers) }, signal);
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return { response, url: url.href };
    await response.body?.cancel();
    const next = new URL(location, url);
    if (next.origin !== url.origin) for (const name of CREDENTIAL_HEADERS) headers.delete(name);
    current = next.href;
  }
  throw new BlockedUrlError('too many redirects');
}

/**
 * The default {@link PinnedRequest}: connects to `address` while TLS verification (SNI) and the
 * `Host` header use the URL's host. A private agent is used, so no environment proxy is involved.
 * A compressed body is decoded here; `readCappedBody` then caps the decoded size.
 */
export function requestPinned(
  url: URL,
  address: string | undefined,
  init: PinnedRequestInit,
  signal: AbortSignal,
): Promise<Response> {
  const secure = url.protocol === 'https:';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const headers: Record<string, string> = {};
  init.headers.forEach((value, name) => { headers[name] = value; });
  headers.host = url.host;
  headers['accept-encoding'] ??= 'gzip, deflate, br';
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request({
      protocol: url.protocol,
      hostname: address ?? host,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method,
      headers,
      signal,
      agent: false,
      ...(secure && !isIP(host) ? { servername: host } : {}),
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status > 599) {
        res.destroy();
        reject(new Error(`unexpected HTTP status ${status}`));
        return;
      }
      const responseHeaders = new Headers();
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
        try {
          responseHeaders.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!);
        } catch {
          // a header value the Fetch API cannot hold is dropped
        }
      }
      if (init.method === 'HEAD' || status === 204 || status === 205 || status === 304) {
        res.resume();
        resolve(new Response(null, { status, statusText: res.statusMessage ?? '', headers: responseHeaders }));
        return;
      }
      let body: Readable = res;
      const encoding = responseHeaders.get('content-encoding')?.trim().toLowerCase();
      const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? createGunzip()
        : encoding === 'deflate' ? createInflate()
          : encoding === 'br' ? createBrotliDecompress()
            : undefined;
      if (decoder) {
        res.once('error', (error) => decoder.destroy(error));
        decoder.once('close', () => res.destroy());
        body = res.pipe(decoder);
        responseHeaders.delete('content-encoding');
        responseHeaders.delete('content-length');
      }
      resolve(new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
        status,
        statusText: res.statusMessage ?? '',
        headers: responseHeaders,
      }));
    });
    req.once('error', reject);
    req.end();
  });
}

/** Read a body with a byte cap; the stream is cancelled and `undefined` returned once it is exceeded. */
export async function readCappedBody(response: Response, maxBytes: number): Promise<Buffer | undefined> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
