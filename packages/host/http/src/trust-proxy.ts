/**
 * Client address behind reverse proxies (`http.trustProxy`). Without it every request is
 * attributed to its TCP peer and forwarding headers are ignored, so a client can never spoof its
 * address. With it, `X-Forwarded-For` (or RFC 7239 `Forwarded`) is walked from the peer towards
 * the client while each hop is trusted.
 */
import { isIP } from 'node:net';

/**
 * `true` trusts every hop; a number trusts that many hops next to the server; a list trusts
 * peers matching an IP or CIDR (`10.0.0.0/8`, `::1`, `fd00::/8`) and the aliases `loopback`,
 * `private` (RFC 1918 / ULA) and `linklocal`.
 */
export type TrustProxySetting = boolean | number | readonly string[];

/** Decides whether a hop is a trusted proxy; `index` 0 is the TCP peer. */
export type TrustProxyPredicate = (address: string, index: number) => boolean;

const ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  loopback: ['127.0.0.0/8', '::1/128'],
  private: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
});

export class TrustProxyConfigError extends Error {
  constructor(message: string) {
    super(`http.trustProxy: ${message}`);
    this.name = 'TrustProxyConfigError';
  }
}

/** Validates a raw config value; `undefined` / `false` → undefined (feature off). */
export function parseTrustProxy(value: unknown): TrustProxySetting | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (typeof value === 'string') {
    // Environment placeholders expand to strings: "true", "2", "10.0.0.0/8, ::1".
    const text = value.trim().toLowerCase();
    if (text === '' || text === 'false') return undefined;
    if (text === 'true') return true;
    if (/^\d+$/u.test(text)) return parseTrustProxy(Number(text));
  }
  if (value === true) return true;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || value > 32) throw new TrustProxyConfigError('hop count must be an integer 0–32');
    return value === 0 ? undefined : value;
  }
  const list = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(list)) throw new TrustProxyConfigError('must be true, a hop count, or a list of proxy IPs / CIDRs');
  const entries = list.map(entry => String(entry).trim()).filter(Boolean);
  for (const entry of entries) compileEntry(entry);
  return entries.length === 0 ? undefined : Object.freeze(entries);
}

/** Predicate for a setting; undefined means no hop is trusted. */
export function compileTrustProxy(setting: TrustProxySetting | undefined): TrustProxyPredicate | undefined {
  if (setting === undefined || setting === false) return undefined;
  if (setting === true) return () => true;
  if (typeof setting === 'number') return (_address, index) => index < setting;
  const matchers = setting.flatMap(entry => compileEntry(entry));
  return (address) => {
    const parsed = parseAddress(address);
    return parsed !== undefined && matchers.some(matcher => matcher(parsed));
  };
}

/** True when the request carries any proxy forwarding header. */
export function hasForwardingHeaders(headers: Headers | Readonly<Record<string, unknown>>): boolean {
  const get = (name: string): unknown => headers instanceof Headers ? headers.get(name) : headers[name];
  return get('x-forwarded-for') != null || get('forwarded') != null;
}

/**
 * Client address for one request. Returns the peer unchanged unless the peer is trusted; then
 * walks the forwarded chain right to left and returns the first untrusted hop (or the leftmost).
 */
export function resolveClientAddress(
  peer: string | undefined,
  headers: Headers | Readonly<Record<string, unknown>>,
  trust: TrustProxyPredicate | undefined,
): string | undefined {
  if (!peer || !trust) return peer;
  const chain = forwardedChain(headers);
  if (chain === undefined) return peer;
  const hops = [normalizeAddress(peer), ...chain.reverse()];
  let index = 0;
  while (index < hops.length - 1 && trust(hops[index]!, index)) index += 1;
  return hops[index];
}

/** Forwarded addresses, client first; undefined when absent or malformed (fail closed to the peer). */
function forwardedChain(headers: Headers | Readonly<Record<string, unknown>>): string[] | undefined {
  const read = (name: string): string | undefined => {
    const value = headers instanceof Headers ? headers.get(name) : headers[name];
    if (value == null) return undefined;
    return Array.isArray(value) ? value.join(',') : String(value);
  };
  const xff = read('x-forwarded-for');
  const raw = xff !== undefined
    ? xff.split(',').map(part => part.trim())
    : read('forwarded')?.split(',').map(part => forwardedFor(part));
  if (!raw || raw.length === 0) return undefined;
  const chain: string[] = [];
  for (const entry of raw) {
    const address = entry === undefined ? undefined : normalizeAddress(stripPort(entry));
    if (!address || isIP(address) === 0) return undefined;
    chain.push(address);
  }
  return chain;
}

/** `for=` of one RFC 7239 element; `for="[2001:db8::1]:80"`, `for=192.0.2.1`. */
function forwardedFor(element: string): string | undefined {
  for (const pair of element.split(';')) {
    const [key, ...rest] = pair.split('=');
    if (key?.trim().toLowerCase() !== 'for') continue;
    return rest.join('=').trim().replace(/^"|"$/gu, '');
  }
  return undefined;
}

function stripPort(value: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/u.exec(value);
  if (bracketed) return bracketed[1]!;
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/u.exec(value);
  return v4 ? v4[1]! : value;
}

function normalizeAddress(address: string): string {
  const lower = address.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(lower);
  return mapped ? mapped[1]! : lower;
}

interface ParsedAddress {
  readonly family: 4 | 6;
  readonly value: bigint;
}

function parseAddress(address: string): ParsedAddress | undefined {
  const normalized = normalizeAddress(address);
  const family = isIP(normalized);
  if (family === 4) {
    return { family: 4, value: normalized.split('.').reduce((sum, part) => (sum << 8n) + BigInt(Number(part)), 0n) };
  }
  if (family === 6) return { family: 6, value: ipv6ToBigInt(normalized) };
  return undefined;
}

function ipv6ToBigInt(address: string): bigint {
  let text = address.split('%')[0]!;
  const v4Tail = /(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(text);
  if (v4Tail) {
    const parts = v4Tail[1]!.split('.').map(Number);
    text = `${text.slice(0, -v4Tail[1]!.length)}${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string | undefined];
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...Array<string>(missing).fill('0'), ...tailParts];
  return groups.reduce((sum, group) => (sum << 16n) + BigInt(parseInt(group || '0', 16)), 0n);
}

function compileEntry(entry: string): Array<(address: ParsedAddress) => boolean> {
  const alias = ALIASES[entry.toLowerCase()];
  if (alias) return alias.flatMap(compileEntry);
  const [ip, prefixText] = entry.split('/') as [string, string | undefined];
  const parsed = parseAddress(ip);
  if (!parsed) throw new TrustProxyConfigError(`"${entry}" is not an IP address, CIDR or alias (loopback, private, linklocal)`);
  const bits = parsed.family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits || (prefixText !== undefined && !/^\d+$/u.test(prefixText))) {
    throw new TrustProxyConfigError(`"${entry}" has an invalid prefix length`);
  }
  const shift = BigInt(bits - prefix);
  const network = parsed.value >> shift;
  return [(address) => address.family === parsed.family && (address.value >> shift) === network];
}
