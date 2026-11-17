/**
 * Outbound address policy for URLs that come from chat users or third-party pages (SSRF guard).
 *
 * This process connects to the target itself, so a URL is requested only when its host is a
 * public name and every address it resolves to is public. Redirects are followed by hand and
 * each hop is checked again. The check and the connection use separate DNS lookups, so a
 * rebinding resolver can still race them; that needs a connection-level lookup hook.
 *
 * Plugins may not depend on each other, so this small module is duplicated in the plugins that
 * fetch user-supplied URLs. Keep the copies identical.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

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

/**
 * Parse `input` and refuse anything that is not an http(s) URL on a public host.
 * Fails closed: an unresolvable name, or a name with any non-public address, is refused.
 */
export async function assertPublicUrl(
  input: string | URL,
  lookup: HostLookup = systemLookup,
  allowPrivateNetwork = false,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BlockedUrlError('not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('only http and https are allowed');
  if (url.username || url.password) throw new BlockedUrlError('credentials in the URL are not allowed');
  // Operator opt-in (never chat users): scheme and credential rules still apply, the address policy does not.
  if (allowPrivateNetwork) return url;
  // The WHATWG parser already canonicalised odd IPv4 spellings (0x7f.1, 2130706433) to dotted quads.
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrlError(`${host} is not a public address`);
    return url;
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
  return url;
}

export interface PublicFetchOptions {
  /** Bounds every hop and the body read of the returned response. */
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  readonly init?: Omit<RequestInit, 'redirect' | 'signal'>;
  /** Extra per-hop rule on top of the address policy (for example a host allow-list). */
  readonly allow?: (url: URL) => boolean;
  readonly lookup?: HostLookup;
  /** Skip the public-address requirement. Only for an explicit operator setting; default false. */
  readonly allowPrivateNetwork?: boolean;
}

export interface PublicResponse {
  readonly response: Response;
  /** URL of the hop that produced `response`. */
  readonly url: string;
}

/** Fetch with redirects followed by hand so that every hop passes the address policy first. */
export async function fetchPublic(input: string, options: PublicFetchOptions = {}): Promise<PublicResponse> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const maxRedirects = options.maxRedirects ?? 5;
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = await assertPublicUrl(current, options.lookup, options.allowPrivateNetwork);
    if (options.allow && !options.allow(url)) throw new BlockedUrlError(`${url.hostname} is outside the allow-list`);
    const response = await fetch(url.href, { ...options.init, redirect: 'manual', signal });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return { response, url: url.href };
    await response.body?.cancel();
    current = new URL(location, url).href;
  }
  throw new BlockedUrlError('too many redirects');
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
