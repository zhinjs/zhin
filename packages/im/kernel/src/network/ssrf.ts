/**
 * Address rules for requests to targets someone outside the host controls (SSRF guard).
 *
 * Moved from `@zhin.js/agent` (`security/network-policy.ts`, which re-exports them) so that the IM
 * core and adapters can apply the same rules without importing the Agent layer (#1250 第 46 批).
 */
import { BlockList, isIP } from 'node:net';

/** SSRF 防护：检查主机名是否属于内网/私有/危险地址 */
export function isBlockedSsrfHostname(hostname: string): boolean {
  // A fully-qualified trailing dot (`localhost.`) resolves the same host; strip it before matching.
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(h)) return isBlockedIpAddress(h);
  return (
    // Localhost
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h.endsWith('.local') ||
    // IPv4 private ranges
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    // Cloud metadata endpoints (AWS/GCP/Azure)
    h === '169.254.169.254' ||
    h === 'metadata.google.internal' ||
    h === 'metadata.google.com' ||
    // IPv6 private/link-local ranges
    /^(?:fc|fd)[0-9a-f]{2}:/i.test(h) ||
    /^fe80:/i.test(h) ||
    /^::ffff:(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(h) ||
    // System-level domain blocklist
    h.endsWith('.onion') ||
    h.endsWith('.internal') ||
    h.endsWith('.localhost')
  );
}

/** Host-internal endpoints inside otherwise public IPv4 space (Azure WireServer). */
const HOST_INTERNAL_IPV4: ReadonlySet<string> = new Set(['168.63.129.16']);

/**
 * IPv6 is an allow-list: only global unicast (2000::/3) is public, minus the ranges inside it that
 * embed or tunnel to an IPv4 address or are not routable. Everything outside 2000::/3 — NAT64
 * `64:ff9b::/96` and `64:ff9b:1::/48`, IPv4-compatible `::/96`, site-local `fec0::/10`, discard
 * `100::/64`, ULA, link-local, multicast — is refused (#1250 第 45 批).
 */
const GLOBAL_IPV6 = new BlockList();
GLOBAL_IPV6.addSubnet('2000::', 3, 'ipv6');
const SPECIAL_GLOBAL_IPV6 = new BlockList();
for (const [base, bits] of [
  // Teredo, benchmarking, ORCHID, documentation, 6to4, documentation (RFC 9637).
  ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) SPECIAL_GLOBAL_IPV6.addSubnet(base, bits, 'ipv6');

export function isBlockedIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [a, b, c] = octets;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b! >= 64 && b! <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 88 && c === 99)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a! >= 224
      || HOST_INTERNAL_IPV4.has(normalized);
  }
  if (isIP(normalized) === 6) {
    if (normalized === '::' || normalized === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(normalized)?.[1];
    if (mapped) return isBlockedIpAddress(mapped);
    // WHATWG URL canonicalization also covers expanded IPv4-mapped IPv6 spelling.
    // Apply exactly the IPv4 rules to mapped hex addresses before the IPv6 ranges.
    let canonical: string;
    try { canonical = new URL(`http://[${normalized}]/`).hostname.slice(1, -1); }
    catch { return true; }
    if (canonical === '::' || canonical === '::1') return true;
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(canonical);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1]!, 16);
      const low = Number.parseInt(mappedHex[2]!, 16);
      return isBlockedIpAddress([high >>> 8, high & 255, low >>> 8, low & 255].join('.'));
    }
    return !GLOBAL_IPV6.check(canonical, 'ipv6') || SPECIAL_GLOBAL_IPV6.check(canonical, 'ipv6');
  }
  return true;
}

export class NetworkAccessDeniedError extends Error {
  readonly policy = 'network-access';

  constructor(message: string) {
    super(message);
    this.name = 'NetworkAccessDeniedError';
  }
}

/** 检查主机名是否匹配域名列表（精确匹配或子域名匹配） */
export function hostnameMatchesList(hostname: string, domains: string[]): boolean {
  const h = hostname.toLowerCase();
  return domains.some(domain => {
    const d = domain.toLowerCase().replace(/^\./, '');
    return h === d || h.endsWith('.' + d);
  });
}

/**
 * Port rule of a download from a URL someone outside the host controls (#1250 第 48 批): only the
 * scheme's default port (https 443, http 80 — the WHATWG parser drops an explicit default port, so
 * `https://host:443/` counts as no port) unless the caller lists more in `allowedPorts`. Any other
 * port — `https://host:22/`, `:8443`, `:0` — would let the instance open a TLS handshake to an
 * arbitrary public host and port, i.e. probe ports for whoever chose the URL.
 *
 * `https://host:80/` is not a default port (80 is http's), so it is refused like any other.
 */
export function isDefaultOrAllowedPort(url: URL, allowedPorts: readonly number[] = []): boolean {
  if (url.port === '') return true;
  const port = Number(url.port);
  return Number.isInteger(port) && port >= 1 && port <= 65535 && allowedPorts.includes(port);
}

export interface UrlNetworkPolicyConfig {
  httpsOnly?: boolean;
  allowedDomains: string[];
}

export function checkUrlNetworkAccess(
  url: string,
  config: UrlNetworkPolicyConfig,
): { allowed: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: '网络请求必须提供可校验的绝对 URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: `网络策略仅支持 HTTP/HTTPS 请求，拒绝 ${parsed.protocol}` };
  }
  if (config.httpsOnly && parsed.protocol !== 'https:') {
    return { allowed: false, reason: `当前网络策略仅允许 HTTPS 请求，拒绝 ${parsed.protocol}` };
  }
  if (isBlockedSsrfHostname(parsed.hostname)) {
    return { allowed: false, reason: `URL 目标 ${parsed.hostname} 属于内网/私有/危险地址` };
  }
  if (config.allowedDomains.length > 0 && !hostnameMatchesList(parsed.hostname, config.allowedDomains)) {
    return {
      allowed: false,
      reason: `域名 ${parsed.hostname} 不在网络允许列表中（允许: ${config.allowedDomains.join(', ')}）`,
    };
  }
  return { allowed: true };
}
