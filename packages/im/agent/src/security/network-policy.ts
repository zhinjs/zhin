/**
 * 统一网络安全策略 — SSRF 防护、域名白名单、网络命令检测
 *
 * 合并了原散落在 web-fetch-tool.ts / sandbox.ts / exec-policy.ts 中的
 * 网络安全检查逻辑，作为单一事实来源。
 */

// ── 网络命令模式 ──────────────────────────────────────────────────────

/** 网络命令模式（当 enableNetwork: false 时阻断） */
export const NETWORK_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /\bcurl\s+/,
  /\bwget\s+/,
  /\bnc\s+/,
  /\bnetcat\s+/,
  /\bssh\s+/,
  /\bscp\s+/,
  /\brsync\s+/,
  /\bping\s+/,
  /\bdig\s+/,
  /\bnslookup\s+/,
  /\bhost\s+/,
  /\btraceroute\s+/,
  /\bnmap\s+/,
  /\bhttp\s+/,
  /\bhttps\s+/,
];

// ── SSRF 防护 ─────────────────────────────────────────────────────────

import { isIP } from 'node:net';
import { scanShellSegment } from './shell-syntax.js';

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

// ── 域名匹配 ──────────────────────────────────────────────────────────

/** 检查主机名是否匹配域名列表（精确匹配或子域名匹配） */
export function hostnameMatchesList(hostname: string, domains: string[]): boolean {
  const h = hostname.toLowerCase();
  return domains.some(domain => {
    const d = domain.toLowerCase().replace(/^\./, '');
    return h === d || h.endsWith('.' + d);
  });
}

// ── URL 提取 ───────────────────────────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s'"`&|;)}\]]+/gi;

/** 从命令中提取所有 URL（小写） */
export function extractUrlsFromCommand(command: string): string[] {
  return (command.match(URL_PATTERN) || []).map(u => u.toLowerCase());
}

// ── 网络命令目标提取 ───────────────────────────────────────────────────

const BARE_HOST_ARG = /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?)(?::\d+)?(?:[/?#].*)?$/i;

/**
 * Every hostname a curl/wget command may contact: all scheme-qualified URLs plus bare
 * `host[:port][/path]` positional arguments, which curl/wget treat as `http://host`.
 * Option values that merely look like a host are included too — over-inclusion only
 * matters when such a value names a blocked address, which fails closed.
 */
export function extractNetworkCommandHostnames(command: string): string[] {
  const hostnames = new Set<string>();
  const add = (candidate: string) => {
    try {
      const hostname = new URL(candidate).hostname;
      if (hostname) hostnames.add(hostname);
    } catch {
      // not a parsable URL
    }
  };
  for (const url of command.match(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`&|;)}\]]+/gi) ?? []) add(url);
  const invocation = findNetworkToolInvocation(command);
  if (invocation) {
    for (const word of positionalNetworkArgs(invocation.tool, invocation.args)) {
      if (word.includes('://') || !BARE_HOST_ARG.test(word)) continue;
      add(`http://${word}`);
    }
  }
  return [...hostnames];
}

// ── 数据外泄检测 ───────────────────────────────────────────────────────

/** Short options that consume a value; the rest of a short cluster (or the next word) belongs to them. */
const SHORT_VALUE_OPTIONS: Readonly<Record<'curl' | 'wget', string>> = {
  curl: 'AbcCdDeEFHKmoPQrtTuUwxXyYz',
  wget: 'aABDeiIlLoOPQRtTUwX',
};
/** Common long options written as `--name value`; `--url` is absent on purpose (its value is a target). */
const LONG_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '--output', '--header', '--request', '--user', '--user-agent', '--referer', '--cookie', '--cookie-jar',
  '--max-time', '--connect-timeout', '--retry', '--retry-delay', '--write-out', '--range', '--cacert',
  '--cert', '--key', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json',
  '--form', '--form-string', '--upload-file', '--output-dir', '--max-filesize', '--limit-rate',
  '--output-document', '--output-file', '--directory-prefix', '--timeout', '--tries', '--wait',
]);

function findNetworkToolInvocation(command: string): { tool: 'curl' | 'wget'; args: string[] } | undefined {
  const { words } = scanShellSegment(command);
  const start = words.findIndex(word => /(?:^|\/)(?:curl|wget)$/.test(word));
  if (start < 0) return undefined;
  return { tool: words[start]!.endsWith('wget') ? 'wget' : 'curl', args: words.slice(start + 1) };
}

/** Arguments that are not options or option values. Unknown long options do not consume a value (over-inclusive). */
function positionalNetworkArgs(tool: 'curl' | 'wget', args: readonly string[]): string[] {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const word = args[i]!;
    if (word.startsWith('--')) {
      if (!word.includes('=') && LONG_VALUE_OPTIONS.has(word)) i++;
      continue;
    }
    if (word.startsWith('-') && word.length > 1) {
      const valueFlag = [...word.slice(1)].findIndex(flag => SHORT_VALUE_OPTIONS[tool].includes(flag));
      // Value attached to the cluster (`-ofile`) stays in this word; otherwise it is the next word.
      if (valueFlag >= 0 && valueFlag === word.length - 2) i++;
      continue;
    }
    positional.push(word);
  }
  return positional;
}

const CURL_DATA_LONG_OPTIONS: ReadonlySet<string> = new Set([
  '--data', '--data-binary', '--data-ascii', '--data-urlencode', '--json',
]);

function uploadsLocalFile(tool: 'curl' | 'wget', words: readonly string[]): boolean {
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const name = eq >= 0 ? word.slice(0, eq) : word;
      const value = eq >= 0 ? word.slice(eq + 1) : words[i + 1] ?? '';
      if (name === '--upload-file' || name === '--post-file' || name === '--body-file') return true;
      // `--data-urlencode name@file` also reads a file.
      if (CURL_DATA_LONG_OPTIONS.has(name) && value.includes('@')) return true;
      if (name === '--form' && /=[@<]/.test(value)) return true;
      continue;
    }
    if (tool !== 'curl' || !word.startsWith('-') || word.length < 2) continue;
    for (let j = 1; j < word.length; j++) {
      const flag = word[j]!;
      const value = word.slice(j + 1) || words[i + 1] || '';
      if (flag === 'T') return true;
      if (flag === 'd' && value.startsWith('@')) return true;
      if (flag === 'F' && /=[@<]/.test(value)) return true;
      if (SHORT_VALUE_OPTIONS.curl.includes(flag)) break;
    }
  }
  return false;
}

/**
 * 检测 curl/wget 上传本地文件的数据外泄模式：
 * `-d @file` / `-d@file` / `--data* @file` / `-F name=@file` / `-T file` / `--upload-file`，
 * 以及 wget `--post-file` / `--body-file`。
 */
export function isDataExfiltrationAttempt(command: string): boolean {
  const invocation = findNetworkToolInvocation(command);
  if (invocation && uploadsLocalFile(invocation.tool, invocation.args)) return true;
  // Fallback for curl nested in another command's argument (e.g. `sh -c "curl -d @f …"`).
  return /\bcurl\b/i.test(command)
    && /(?:\s-[a-z]*d|--data(?:-binary|-ascii|-urlencode)?|--json)[\s=]*['"]?[^\s'"]*@|(?:\s-[a-z]*F|--form)[\s=]*['"]?[^\s'"]*=[@<]|\s-[a-zA-Z]*T\b|--upload-file\b/.test(command);
}

// ── 网络命令访问控制 ───────────────────────────────────────────────────

export interface NetworkPolicyConfig {
  enableNetwork?: boolean;
  allowedDomains?: string[];
}

/** Per-tool-call network narrowing passed to the policy facade. */
export interface ToolNetworkPolicy {
  httpsOnly?: boolean;
  allowedDomains?: readonly string[];
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

/**
 * 检查网络命令访问权限（sandbox 层）
 * - enableNetwork: false → 阻断所有网络命令
 * - enableNetwork: true + allowedDomains → 仅允许指定域名
 */
export function checkNetworkCommandAccess(
  command: string,
  config: NetworkPolicyConfig,
): { allowed: boolean; reason?: string } {
  // 网络未启用时，阻断所有网络命令
  if (!config.enableNetwork) {
    for (const pattern of NETWORK_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        const cmd = command.match(pattern)?.[0]?.trim() || 'network command';
        return {
          allowed: false,
          reason: `沙箱网络未启用，禁止执行网络命令: ${cmd}（配置 enableNetwork: true 以允许）`,
        };
      }
    }
    return { allowed: true };
  }

  // 网络已启用但有域名白名单时，校验 URL
  if (config.allowedDomains && config.allowedDomains.length > 0) {
    const hostnames = extractNetworkCommandHostnames(command);
    if (hostnames.length === 0) {
      // 网络命令必须包含可校验的 URL
      const hasNetworkCommand = NETWORK_COMMAND_PATTERNS.some(pattern => pattern.test(command));
      if (hasNetworkCommand) {
        return {
          allowed: false,
          reason: `启用 allowedDomains 时，网络命令必须包含可校验的 URL（如 http://example.com）`,
        };
      }
      return { allowed: true };
    }

    for (const hostname of hostnames) {
      if (!hostnameMatchesList(hostname, config.allowedDomains)) {
        return {
          allowed: false,
          reason: `域名 ${hostname} 不在允许列表中（允许: ${config.allowedDomains.join(', ')}）`,
        };
      }
    }
  }

  return { allowed: true };
}

// ── exec-policy 层网络命令 URL 校验 ────────────────────────────────────

/**
 * 校验 exec-policy 允许的网络命令（curl/wget）的 URL 安全性
 * - 阻断数据外泄模式（curl -d @file / -F f=@file / -T file …）
 * - 阻断 SSRF 目标（内网/元数据端点）
 */
export function validateNetworkCommandUrl(command: string): { safe: boolean; reason?: string } {
  // 数据外泄检测
  if (isDataExfiltrationAttempt(command)) {
    return {
      safe: false,
      reason: '检测到潜在数据外泄模式（curl/wget 上传本地文件：-d @file、-F name=@file、-T file 等）。',
    };
  }

  // SSRF 检测 — every URL and bare host argument, not just the first one
  for (const hostname of extractNetworkCommandHostnames(command)) {
    if (isBlockedSsrfHostname(hostname)) {
      return {
        safe: false,
        reason: `URL 目标 ${hostname} 属于内网/私有/危险地址，已被 SSRF 防护拦截。`,
      };
    }
  }

  return { safe: true };
}
