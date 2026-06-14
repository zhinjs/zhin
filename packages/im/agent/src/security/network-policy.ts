/**
 * 统一网络安全策略 — SSRF 防护、域名白名单、网络命令检测
 *
 * 合并了原散落在 web-fetch-tool.ts / sandbox.ts / sandbox-enhanced.ts / exec-policy.ts 中的
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
  /\btraceroute\s+/,
  /\bnmap\s+/,
  /\bhttp\s+/,
  /\bhttps\s+/,
];

// ── SSRF 防护 ─────────────────────────────────────────────────────────

/** SSRF 防护：检查主机名是否属于内网/私有/危险地址 */
export function isBlockedSsrfHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
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
    /^fd[0-9a-f]{2}:/i.test(h) ||
    /^fe80:/i.test(h) ||
    // System-level domain blocklist
    h.endsWith('.onion') ||
    h.endsWith('.internal') ||
    h.endsWith('.localhost')
  );
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

/** 从命令中提取第一个 URL（原始大小写） */
export function extractFirstUrlFromCommand(command: string): string | undefined {
  const match = command.match(/https?:\/\/[^\s'"`&|;)}\]]+/i);
  return match ? match[0] : undefined;
}

// ── 数据外泄检测 ───────────────────────────────────────────────────────

/** 检测 curl 数据外泄模式（curl -d @file） */
export function isDataExfiltrationAttempt(command: string): boolean {
  const lower = command.toLowerCase();
  return /\bcurl\b/.test(lower) && /-d\s+@|--data-binary\s+@/.test(lower);
}

// ── 网络命令访问控制 ───────────────────────────────────────────────────

export interface NetworkPolicyConfig {
  enableNetwork?: boolean;
  allowedDomains?: string[];
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
    const urls = extractUrlsFromCommand(command);
    if (urls.length === 0) {
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

    for (const url of urls) {
      try {
        const hostname = new URL(url).hostname;
        if (!hostnameMatchesList(hostname, config.allowedDomains)) {
          return {
            allowed: false,
            reason: `域名 ${hostname} 不在允许列表中（允许: ${config.allowedDomains.join(', ')}）`,
          };
        }
      } catch {
        // URL 解析失败，放行（可能是相对路径或其他格式）
      }
    }
  }

  return { allowed: true };
}

// ── exec-policy 层网络命令 URL 校验 ────────────────────────────────────

/**
 * 校验 exec-policy 允许的网络命令（curl/wget）的 URL 安全性
 * - 阻断数据外泄模式（curl -d @file）
 * - 阻断 SSRF 目标（内网/元数据端点）
 */
export function validateNetworkCommandUrl(command: string): { safe: boolean; reason?: string } {
  // 数据外泄检测
  if (isDataExfiltrationAttempt(command)) {
    return {
      safe: false,
      reason: '检测到潜在数据外泄模式（curl -d @file）。如需上传文件，请使用具体的文件路径。',
    };
  }

  // SSRF 检测
  const url = extractFirstUrlFromCommand(command);
  if (url) {
    try {
      const hostname = new URL(url).hostname;
      if (isBlockedSsrfHostname(hostname)) {
        return {
          safe: false,
          reason: `URL 目标 ${hostname} 属于内网/私有/危险地址，已被 SSRF 防护拦截。`,
        };
      }
    } catch {
      // URL 解析失败，不拦截
    }
  }

  return { safe: true };
}
