import { message, formatMessage, type NettoolsMessage } from './messages.js';
/**
 * Target address policy (SSRF guard).
 *
 * Network tools probe hosts that users type into chat. Even though the probes
 * themselves run on third-party services (check-host.net, public DoH, RDAP),
 * we refuse anything that points at private, loopback, link-local, reserved or
 * cloud-metadata space so the bot can never be used to map internal networks
 * or poke metadata endpoints through a relay.
 *
 * Design:
 * 1. Canonicalise first. The input is fed through the WHATWG URL host parser,
 *    the same parser browsers and Node's fetch use. It turns odd IPv4 spellings
 *    (`2130706433`, `0x7f.1`, `017700000001`, `127.1`) into dotted quads,
 *    normalises IPv6 and converts IDN to punycode. We then classify the
 *    canonical form, so "what we checked" is exactly "what we send".
 * 2. Classify by bytes. IPv4 and IPv6 are compared as raw bytes against
 *    prefix tables. Embedded IPv4 (IPv4-mapped, NAT64, 6to4) is unwrapped and
 *    classified as IPv4.
 * 3. Allow-list IPv6. Only global unicast (2000::/3) is accepted, minus the
 *    documentation / Teredo / special ranges listed below.
 * 4. Names. Single-label names, internal suffixes (`.local`, `.internal`, ...)
 *    and well-known metadata hostnames are refused before any lookup.
 *    Hostnames are additionally resolved (see target-guard.ts) and refused
 *    when any A/AAAA record is blocked.
 */
import { isIPv4, isIPv6 } from 'node:net';
import { NettoolsError } from './errors.js';

export type ParsedHost =
  | { readonly kind: 'ipv4'; readonly address: string; readonly bytes: Uint8Array }
  | { readonly kind: 'ipv6'; readonly address: string; readonly bytes: Uint8Array }
  | { readonly kind: 'domain'; readonly name: string };

export type AddressVerdict =
  | { readonly blocked: false }
  | { readonly blocked: true; readonly reason: string; readonly detail: NettoolsMessage };

export interface ParseHostOptions {
  /** Allow `_` in labels (needed for DNS names such as `_dmarc.example.com`). */
  readonly allowUnderscore?: boolean;
  /** Minimum number of labels for a domain (default 2, i.e. a full domain). */
  readonly minLabels?: number;
}

const ALLOWED: AddressVerdict = Object.freeze({ blocked: false });

function blocked(detail: NettoolsMessage): AddressVerdict {
  return Object.freeze({ blocked: true, reason: formatMessage(detail), detail });
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

interface PrefixRule {
  readonly prefix: Uint8Array;
  readonly bits: number;
  readonly reason: NettoolsMessage;
}

const CLOUD_METADATA_REASON = message('cloudMetadata');

/** Exact IPv4 metadata endpoints, checked before the range table for a clearer message. */
const CLOUD_METADATA_IPV4 = new Set([
  '169.254.169.254', // AWS / GCP / Azure / Oracle / OpenStack instance metadata
  '169.254.170.2', // AWS ECS task metadata
  '169.254.169.123', // AWS Time Sync
  '100.100.100.200', // Alibaba Cloud metadata
  '168.63.129.16', // Azure WireServer (public range, still host-internal)
]);

/** Exact IPv6 metadata endpoints. */
const CLOUD_METADATA_IPV6 = ['fd00:ec2::254', 'fd00:ec2::23'];

const BLOCKED_IPV4_RANGES: readonly PrefixRule[] = [
  ipv4Rule('0.0.0.0', 8, message('unspecifiedV4')),
  ipv4Rule('10.0.0.0', 8, message('privateV4')),
  ipv4Rule('100.64.0.0', 10, message('cgnat')),
  ipv4Rule('127.0.0.0', 8, message('loopback')),
  ipv4Rule('169.254.0.0', 16, message('linkLocal')),
  ipv4Rule('172.16.0.0', 12, message('privateV4')),
  ipv4Rule('192.0.0.0', 24, message('ietfReserved')),
  ipv4Rule('192.0.2.0', 24, message('documentation')),
  ipv4Rule('192.88.99.0', 24, message('relay6to4')),
  ipv4Rule('192.168.0.0', 16, message('privateV4')),
  ipv4Rule('198.18.0.0', 15, message('benchmark')),
  ipv4Rule('198.51.100.0', 24, message('documentation')),
  ipv4Rule('203.0.113.0', 24, message('documentation')),
  ipv4Rule('224.0.0.0', 4, message('multicast')),
  ipv4Rule('240.0.0.0', 4, message('reservedBroadcast')),
];

/** Special IPv6 ranges inside 2000::/3 that are still refused. */
const BLOCKED_GLOBAL_IPV6_RANGES: readonly PrefixRule[] = [
  ipv6Rule('2001::', 32, message('teredo')),
  ipv6Rule('2001:2::', 48, message('benchmark')),
  ipv6Rule('2001:10::', 28, message('orchid')),
  ipv6Rule('2001:db8::', 32, message('documentation')),
  ipv6Rule('3fff::', 20, message('documentation')),
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

/** Suffixes that only make sense inside a private network or are reserved (RFC 2606 / 6761 / 6762). */
const BLOCKED_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'private',
  'corp',
  'home',
  'lan',
  'home.arpa',
  'arpa',
  'test',
  'invalid',
  'example',
  'onion',
];

const MAX_HOSTNAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse and canonicalise one user-supplied host (domain, IPv4 or IPv6).
 * Throws {@link NettoolsError} (`invalid_input`) for anything that is not a
 * bare host: URLs, ports, paths, user-info, zone ids and percent-encoding are
 * all refused rather than "helpfully" stripped.
 */
export function parseHostInput(input: string, options: ParseHostOptions = {}): ParsedHost {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw invalid(message('hostRequired'));
  }
  if (trimmed.length > MAX_HOSTNAME_LENGTH + 2) {
    throw invalid(message('hostTooLong'));
  }
  if (/[\s/\\@?#%]/u.test(trimmed)) {
    throw invalid(message('bareHost'));
  }

  const bracketed = trimmed.startsWith('[') && trimmed.endsWith(']');
  const ipv6Candidate = bracketed ? trimmed.slice(1, -1) : trimmed;
  if (bracketed || trimmed.includes(':')) {
    if (!isIPv6(ipv6Candidate)) {
      throw invalid(message('ipv6NoPort'));
    }
    const canonical = canonicalizeWithUrlParser(`[${ipv6Candidate}]`);
    const address = canonical.slice(1, -1);
    return Object.freeze({ kind: 'ipv6', address, bytes: ipv6ToBytes(address) });
  }

  const canonical = canonicalizeWithUrlParser(trimmed);
  if (isIPv4(canonical)) {
    return Object.freeze({ kind: 'ipv4', address: canonical, bytes: ipv4ToBytes(canonical) });
  }
  const name = canonical.endsWith('.') ? canonical.slice(0, -1) : canonical;
  validateDomainSyntax(name, options);
  return Object.freeze({ kind: 'domain', name });
}

/**
 * Run the WHATWG host parser by assigning to `URL#hostname` on a placeholder
 * URL. An invalid host leaves the placeholder untouched, which we detect.
 */
function canonicalizeWithUrlParser(host: string): string {
  const placeholder = 'placeholder.invalid';
  const probe = new URL(`http://${placeholder}/`);
  probe.hostname = host;
  const result = probe.hostname;
  const unchanged = result === placeholder && host.toLowerCase() !== placeholder;
  if (unchanged || result.length === 0) {
    throw invalid(message('invalidHost'));
  }
  return result;
}

function validateDomainSyntax(name: string, options: ParseHostOptions): void {
  if (name.length === 0 || name.length > MAX_HOSTNAME_LENGTH) {
    throw invalid(message('hostLength'));
  }
  const labels = name.split('.');
  if (labels.length < (options.minLabels ?? 2)) {
    throw invalid(message('fullDomain'));
  }
  const labelPattern = options.allowUnderscore
    ? /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/u
    : /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH || !labelPattern.test(label)) {
      throw invalid(message('invalidLabel', { label: label || message('empty') }));
    }
  }
  const topLevel = labels[labels.length - 1] ?? '';
  if (/^\d+$/u.test(topLevel)) {
    throw invalid(message('numericTld'));
  }
}

function invalid(detail: NettoolsMessage): NettoolsError {
  return new NettoolsError('invalid_input', detail);
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

/** Classify a parsed host without any network access. Domains are checked by name only. */
export function classifyParsedHost(host: ParsedHost): AddressVerdict {
  if (host.kind === 'domain') {
    return classifyHostname(host.name);
  }
  if (host.kind === 'ipv4') {
    return classifyIpv4Bytes(host.bytes);
  }
  return classifyIpv6Bytes(host.bytes);
}

/** Classify a literal address string (any spelling the URL parser understands). */
export function classifyAddress(address: string): AddressVerdict {
  const parsed = parseHostInput(address);
  if (parsed.kind === 'domain') {
    throw invalid(message('notIp', { address }));
  }
  return classifyParsedHost(parsed);
}

export function classifyHostname(name: string): AddressVerdict {
  const normalized = name.toLowerCase().replace(/\.$/u, '');
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return normalized.startsWith('localhost')
      ? blocked(message('localhost'))
      : blocked(CLOUD_METADATA_REASON);
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (normalized === suffix || normalized.endsWith(`.${suffix}`)) {
      return blocked(message('reservedSuffix', { suffix }));
    }
  }
  return ALLOWED;
}

function classifyIpv4Bytes(bytes: Uint8Array): AddressVerdict {
  const dotted = Array.from(bytes).join('.');
  if (CLOUD_METADATA_IPV4.has(dotted)) {
    return blocked(CLOUD_METADATA_REASON);
  }
  for (const rule of BLOCKED_IPV4_RANGES) {
    if (matchesPrefix(bytes, rule.prefix, rule.bits)) {
      return blocked(rule.reason);
    }
  }
  return ALLOWED;
}

const IPV4_MAPPED_PREFIX = ipv6ToBytes('::ffff:0:0');
const NAT64_WELL_KNOWN_PREFIX = ipv6ToBytes('64:ff9b::');
const NAT64_LOCAL_PREFIX = ipv6ToBytes('64:ff9b:1::');
const SIX_TO_FOUR_PREFIX = ipv6ToBytes('2002::');
const GLOBAL_UNICAST_PREFIX = ipv6ToBytes('2000::');
const UNIQUE_LOCAL_PREFIX = ipv6ToBytes('fc00::');
const LINK_LOCAL_PREFIX = ipv6ToBytes('fe80::');
const SITE_LOCAL_PREFIX = ipv6ToBytes('fec0::');
const MULTICAST_PREFIX = ipv6ToBytes('ff00::');
const CLOUD_METADATA_IPV6_BYTES = CLOUD_METADATA_IPV6.map((address) => ipv6ToBytes(address));

function classifyIpv6Bytes(bytes: Uint8Array): AddressVerdict {
  if (bytes.every((byte) => byte === 0)) {
    return blocked(message('unspecifiedV6'));
  }
  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (isLoopback) {
    return blocked(message('loopbackV6'));
  }
  for (const metadata of CLOUD_METADATA_IPV6_BYTES) {
    if (matchesPrefix(bytes, metadata, 128)) {
      return blocked(CLOUD_METADATA_REASON);
    }
  }
  if (matchesPrefix(bytes, IPV4_MAPPED_PREFIX, 96)) {
    return classifyEmbeddedIpv4(bytes.slice(12, 16), message('mappedV4'));
  }
  if (matchesPrefix(bytes, NAT64_WELL_KNOWN_PREFIX, 96)) {
    return classifyEmbeddedIpv4(bytes.slice(12, 16), message('nat64'));
  }
  if (matchesPrefix(bytes, NAT64_LOCAL_PREFIX, 48)) {
    return blocked(message('localNat64'));
  }
  if (matchesPrefix(bytes, SIX_TO_FOUR_PREFIX, 16)) {
    return classifyEmbeddedIpv4(bytes.slice(2, 6), message('sixToFour'));
  }
  if (matchesPrefix(bytes, UNIQUE_LOCAL_PREFIX, 7)) {
    return blocked(message('ula'));
  }
  if (matchesPrefix(bytes, LINK_LOCAL_PREFIX, 10)) {
    return blocked(message('linkLocalV6'));
  }
  if (matchesPrefix(bytes, SITE_LOCAL_PREFIX, 10)) {
    return blocked(message('siteLocalV6'));
  }
  if (matchesPrefix(bytes, MULTICAST_PREFIX, 8)) {
    return blocked(message('multicastV6'));
  }
  if (!matchesPrefix(bytes, GLOBAL_UNICAST_PREFIX, 3)) {
    return blocked(message('notGlobalV6'));
  }
  for (const rule of BLOCKED_GLOBAL_IPV6_RANGES) {
    if (matchesPrefix(bytes, rule.prefix, rule.bits)) {
      return blocked(rule.reason);
    }
  }
  return ALLOWED;
}

function classifyEmbeddedIpv4(embedded: Uint8Array, wrapper: NettoolsMessage): AddressVerdict {
  const verdict = classifyIpv4Bytes(embedded);
  if (!verdict.blocked) {
    return verdict;
  }
  const dotted = Array.from(embedded).join('.');
  return blocked(message('embeddedV4', { wrapper, address: dotted, reason: verdict.detail }));
}

/* ------------------------------------------------------------------ */
/* Byte helpers                                                        */
/* ------------------------------------------------------------------ */

function matchesPrefix(bytes: Uint8Array, prefix: Uint8Array, bits: number): boolean {
  if (bytes.length !== prefix.length) {
    return false;
  }
  const fullBytes = Math.floor(bits / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== prefix[index]) {
      return false;
    }
  }
  const remainingBits = bits % 8;
  if (remainingBits === 0) {
    return true;
  }
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return ((bytes[fullBytes] ?? 0) & mask) === ((prefix[fullBytes] ?? 0) & mask);
}

/** Dotted-quad IPv4 to 4 bytes. Callers must pass a canonical dotted quad. */
export function ipv4ToBytes(address: string): Uint8Array {
  const parts = address.split('.').map((part) => Number(part));
  const valid = parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  if (!valid) {
    throw invalid(message('invalidV4', { address }));
  }
  return Uint8Array.from(parts);
}

/** Textual IPv6 (with optional `::` and dotted IPv4 tail) to 16 bytes. */
export function ipv6ToBytes(address: string): Uint8Array {
  let text = address.toLowerCase();
  const groups: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  const tailGroups: number[] = [];
  if (tail.includes('.')) {
    const v4 = ipv4ToBytes(tail);
    tailGroups.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0));
    tailGroups.push(((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
    text = text.slice(0, lastColon + 1) + '0:0';
  }
  const halves = text.split('::');
  if (halves.length > 2) {
    throw invalid(message('invalidV6', { address }));
  }
  const head = parseGroups(halves[0] ?? '');
  const rest = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    throw invalid(message('invalidV6', { address }));
  }
  groups.push(...head);
  for (let index = 0; index < missing && halves.length === 2; index += 1) {
    groups.push(0);
  }
  groups.push(...rest);
  if (tailGroups.length === 2) {
    groups.splice(6, 2, ...tailGroups);
  }
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function parseGroups(text: string): number[] {
  if (text.length === 0) {
    return [];
  }
  return text.split(':').map((group) => {
    if (!/^[0-9a-f]{1,4}$/u.test(group)) {
      throw invalid(message('invalidV6Group', { group }));
    }
    return Number.parseInt(group, 16);
  });
}

function ipv4Rule(base: string, bits: number, reason: NettoolsMessage): PrefixRule {
  return Object.freeze({ prefix: ipv4ToBytes(base), bits, reason });
}

function ipv6Rule(base: string, bits: number, reason: NettoolsMessage): PrefixRule {
  return Object.freeze({ prefix: ipv6ToBytes(base), bits, reason });
}

/** Build the PTR query name for an IP (`in-addr.arpa` / `ip6.arpa`). */
export function reverseLookupName(host: ParsedHost): string {
  if (host.kind === 'ipv4') {
    return `${Array.from(host.bytes).reverse().join('.')}.in-addr.arpa`;
  }
  if (host.kind === 'ipv6') {
    const nibbles: string[] = [];
    for (const byte of host.bytes) {
      nibbles.push((byte >> 4).toString(16));
      nibbles.push((byte & 0x0f).toString(16));
    }
    return `${nibbles.reverse().join('.')}.ip6.arpa`;
  }
  throw invalid(message('reverseNeedsIp'));
}

/** Human label for a parsed host. */
export function displayHost(host: ParsedHost): string {
  return host.kind === 'domain' ? host.name : host.address;
}
