/**
 * Address rules for requests to targets someone outside the host controls (SSRF guard).
 *
 * Moved from `@zhin.js/agent` (`security/network-policy.ts`, which re-exports them) so that the IM
 * core and adapters can apply the same rules without importing the Agent layer (#1250 第 46 批).
 */
import { isIP } from 'node:net';

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

export function isBlockedIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [a, b] = octets;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b! >= 64 && b! <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a! >= 224;
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
    return /^(?:fc|fd)/i.test(canonical)
      || /^fe[89ab]/i.test(canonical)
      || /^ff/i.test(canonical);
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
