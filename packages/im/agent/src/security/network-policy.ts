/**
 * 网络访问安全策略
 *
 * 控制 AI Agent 的网络请求，防止：
 * - 访问恶意域名
 * - 数据外泄
 * - SSRF 攻击
 * - 资源滥用
 *
 */

import { URL } from 'node:url';

// ── 网络策略配置 ──────────────────────────────────────────────────────

export interface NetworkPolicyConfig {
  /** 是否启用网络策略 */
  enabled: boolean;
  /** 域名白名单（允许访问） */
  allowedDomains?: string[];
  /** 域名黑名单（禁止访问） */
  blockedDomains?: string[];
  /** IP 黑名单 */
  blockedIPs?: string[];
  /** 禁止私有 IP */
  blockPrivateIPs?: boolean;
  /** 最大请求大小（字节） */
  maxRequestSize?: number;
  /** 最大响应大小（字节） */
  maxResponseSize?: number;
  /** 请求超时（毫秒） */
  requestTimeout?: number;
  /** 每分钟最大请求数 */
  rateLimit?: number;
  /** 禁止的协议 */
  blockedProtocols?: string[];
  /** 禁止的端口 */
  blockedPorts?: number[];
}

const DEFAULT_CONFIG: NetworkPolicyConfig = {
  enabled: true,
  blockPrivateIPs: true,
  maxRequestSize: 10 * 1024 * 1024,      // 10 MB
  maxResponseSize: 50 * 1024 * 1024,     // 50 MB
  requestTimeout: 30000,                  // 30 秒
  rateLimit: 100,                         // 每分钟 100 次
  blockedProtocols: ['file', 'ftp', 'gopher'],
  blockedPorts: [22, 23, 25, 465, 587, 1080, 3389, 5900],
};

// ── 私有 IP 检测 ──────────────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./,                     // 192.168.0.0/16
  /^127\./,                          // 127.0.0.0/8 (localhost)
  /^0\./,                            // 0.0.0.0
  /^::1$/,                           // IPv6 localhost
  /^fc00:/,                          // IPv6 private
  /^fd[0-9a-f]{2}:/,                // IPv6 private
  /^fe80:/,                          // IPv6 link-local
];

/**
 * 检查 IP 是否为私有地址
 */
function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(ip));
}

// ── 常见危险域名模式 ──────────────────────────────────────────────────

const SUSPICIOUS_DOMAIN_PATTERNS = [
  /\.tk$/i,      // 免费域名，常用于钓鱼
  /\.ml$/i,
  /\.ga$/i,
  /\.cf$/i,
  /\.gq$/i,
  /pastebin\.com/i,  // 代码分享，可能含恶意内容
  /hastebin\.com/i,
  /ngrok\.io/i,      // 隧道服务
  /serveo\.net/i,
  /localtunnel\.me/i,
];

// ── 速率限制器 ────────────────────────────────────────────────────────

class RateLimiter {
  private requests: Map<string, number[]> = new Map();

  /**
   * 检查是否超过速率限制
   * @returns true 表示超过限制
   */
  isLimited(key: string, limit: number, windowMs: number = 60000): boolean {
    const now = Date.now();
    const windowStart = now - windowMs;

    // 获取或初始化请求记录
    let timestamps = this.requests.get(key) || [];

    // 清理过期记录
    timestamps = timestamps.filter(t => t > windowStart);

    // 检查是否超过限制
    if (timestamps.length >= limit) {
      return true;
    }

    // 记录本次请求
    timestamps.push(now);
    this.requests.set(key, timestamps);

    return false;
  }

  /**
   * 清理过期记录
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter(t => t > now - 120000); // 保留 2 分钟内的记录
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }
}

// ── 网络策略检查结果 ──────────────────────────────────────────────────

export interface NetworkPolicyResult {
  allowed: boolean;
  reason?: string;
  /** 脱敏后的 URL */
  sanitizedUrl?: string;
}

// ── 网络策略类 ────────────────────────────────────────────────────────

export class NetworkPolicy {
  private config: NetworkPolicyConfig;
  private rateLimiter: RateLimiter;

  constructor(config: Partial<NetworkPolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rateLimiter = new RateLimiter();

    // 定期清理速率限制器
    setInterval(() => this.rateLimiter.cleanup(), 60000);
  }

  /**
   * 检查 URL 是否允许访问
   */
  checkUrl(url: string, userId?: string): NetworkPolicyResult {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: '无效的 URL 格式' };
    }

    // 1. 协议检查
    if (this.config.blockedProtocols?.includes(parsed.protocol.replace(':', ''))) {
      return {
        allowed: false,
        reason: `禁止的协议: ${parsed.protocol}`,
        sanitizedUrl: `${parsed.protocol}//***`,
      };
    }

    // 2. 端口检查
    const port = parsed.port ? parseInt(parsed.port, 10) : this.getDefaultPort(parsed.protocol);
    if (port && this.config.blockedPorts?.includes(port)) {
      return {
        allowed: false,
        reason: `禁止的端口: ${port}`,
        sanitizedUrl: `${parsed.protocol}//${parsed.hostname}:***`,
      };
    }

    // 3. 私有 IP 检查（在白名单检查之前）
    const hostname = parsed.hostname.toLowerCase();
    if (this.config.blockPrivateIPs && this.isPrivateIP(hostname)) {
      return {
        allowed: false,
        reason: '禁止访问私有 IP 地址',
        sanitizedUrl: `${parsed.protocol}//***`,
      };
    }

    // 4. 可疑域名检查（在白名单检查之前）
    if (this.isSuspiciousDomain(hostname)) {
      return {
        allowed: false,
        reason: `可疑域名: ${this.maskDomain(hostname)}`,
        sanitizedUrl: `${parsed.protocol}//${this.maskDomain(hostname)}`,
      };
    }

    // 5. 域名黑名单检查
    if (this.isBlockedDomain(hostname)) {
      return {
        allowed: false,
        reason: `域名在黑名单中: ${this.maskDomain(hostname)}`,
        sanitizedUrl: `${parsed.protocol}//${this.maskDomain(hostname)}`,
      };
    }

    // 6. 域名白名单检查
    if (this.config.allowedDomains && this.config.allowedDomains.length > 0) {
      if (!this.isAllowedDomain(hostname)) {
        return {
          allowed: false,
          reason: `域名不在白名单中: ${this.maskDomain(hostname)}`,
          sanitizedUrl: `${parsed.protocol}//${this.maskDomain(hostname)}`,
        };
      }
    }

    // 7. 速率限制检查
    const rateLimitKey = userId || hostname;
    if (this.config.rateLimit && this.rateLimiter.isLimited(rateLimitKey, this.config.rateLimit)) {
      return {
        allowed: false,
        reason: '请求过于频繁，请稍后再试',
        sanitizedUrl: `${parsed.protocol}//${this.maskDomain(hostname)}`,
      };
    }

    // 通过所有检查
    return {
      allowed: true,
      sanitizedUrl: `${parsed.protocol}//${this.maskDomain(hostname)}${parsed.pathname}`,
    };
  }

  /**
   * 检查域名是否在黑名单中
   */
  private isBlockedDomain(domain: string): boolean {
    if (!this.config.blockedDomains) return false;

    return this.config.blockedDomains.some(blocked => {
      // 支持通配符匹配
      if (blocked.startsWith('*.')) {
        const suffix = blocked.slice(1); // *.example.com -> .example.com
        return domain.endsWith(suffix) || domain === suffix.slice(1);
      }
      return domain === blocked || domain.endsWith(`.${blocked}`);
    });
  }

  /**
   * 检查域名是否在白名单中
   */
  private isAllowedDomain(domain: string): boolean {
    if (!this.config.allowedDomains || this.config.allowedDomains.length === 0) {
      return true; // 没有白名单则允许所有
    }

    return this.config.allowedDomains.some(allowed => {
      if (allowed.startsWith('*.')) {
        const suffix = allowed.slice(1);
        return domain.endsWith(suffix) || domain === suffix.slice(1);
      }
      return domain === allowed || domain.endsWith(`.${allowed}`);
    });
  }

  /**
   * 检查是否为可疑域名
   */
  private isSuspiciousDomain(domain: string): boolean {
    return SUSPICIOUS_DOMAIN_PATTERNS.some(pattern => pattern.test(domain));
  }

  /**
   * 检查是否为私有 IP
   */
  private isPrivateIP(hostname: string): boolean {
    // 简单的 IP 格式检查
    const ipPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (!ipPattern.test(hostname)) {
      // 可能是域名，需要解析（这里简化处理）
      return false;
    }
    return isPrivateIP(hostname);
  }

  /**
   * 获取默认端口
   */
  private getDefaultPort(protocol: string): number | null {
    const ports: Record<string, number> = {
      'http:': 80,
      'https:': 443,
      'ftp:': 21,
      'ssh:': 22,
    };
    return ports[protocol] || null;
  }

  /**
   * 脱敏域名
   */
  private maskDomain(domain: string): string {
    const parts = domain.split('.');
    if (parts.length <= 2) {
      return domain; // 顶级域名不脱敏
    }
    // 保留顶级域名，中间部分脱敏
    return `***.${parts.slice(-2).join('.')}`;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<NetworkPolicyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置（脱敏）
   */
  getConfig(): NetworkPolicyConfig {
    return { ...this.config };
  }
}

// ── 全局网络策略实例 ──────────────────────────────────────────────────

let globalNetworkPolicy: NetworkPolicy | null = null;

/**
 * 获取全局网络策略实例
 */
export function getNetworkPolicy(): NetworkPolicy {
  if (!globalNetworkPolicy) {
    globalNetworkPolicy = new NetworkPolicy();
  }
  return globalNetworkPolicy;
}

/**
 * 初始化网络策略
 */
export function initNetworkPolicy(config: Partial<NetworkPolicyConfig>): NetworkPolicy {
  globalNetworkPolicy = new NetworkPolicy(config);
  return globalNetworkPolicy;
}

/**
 * 检查 URL 是否允许访问
 */
export function checkNetworkAccess(url: string, userId?: string): NetworkPolicyResult {
  return getNetworkPolicy().checkUrl(url, userId);
}
