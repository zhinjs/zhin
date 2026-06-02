/**
 * Agent 安全策略配置示例
 *
 * 展示如何配置所有安全策略。
 */

import type { SecurityPolicyConfig } from './index.js';

/**
 * 生产环境安全配置
 *
 * 严格的安全策略，适用于生产环境
 */
export const PRODUCTION_SECURITY_CONFIG: SecurityPolicyConfig = {
  // 审计日志配置
  audit: {
    enabled: true,
    logFile: 'data/audit/agent-audit.log',
    minSeverity: 'info',
    logSensitiveData: false, // 生产环境不记录敏感数据
    retentionDays: 90,       // 保留 90 天
    maxFileSizeMB: 200,      // 最大 200MB
  },

  // 网络策略配置
  network: {
    enabled: true,
    // 允许访问的域名（白名单）
    allowedDomains: [
      'api.openai.com',
      'api.anthropic.com',
      'api.ollama.ai',
      'github.com',
      'api.github.com',
      'registry.npmjs.org',
      'api.npmjs.org',
    ],
    // 禁止访问的域名（黑名单）
    blockedDomains: [
      '*.malware.com',
      '*.phishing.com',
      'pastebin.com',
      'hastebin.com',
    ],
    // 禁止私有 IP
    blockPrivateIPs: true,
    // 请求限制
    maxRequestSize: 5 * 1024 * 1024,   // 5MB
    maxResponseSize: 20 * 1024 * 1024, // 20MB
    requestTimeout: 15000,             // 15 秒
    rateLimit: 60,                     // 每分钟 60 次
    // 禁止的协议
    blockedProtocols: ['file', 'ftp', 'gopher', 'ssh'],
    // 禁止的端口
    blockedPorts: [22, 23, 25, 465, 587, 1080, 3306, 5432, 6379, 27017],
  },

  // 预算限制配置
  budget: {
    enabled: true,
    // Token 限制
    maxTokensPerSession: 500000,       // 500K tokens
    maxTokensPerUserPerDay: 2000000,   // 2M tokens
    // 成本限制
    maxCostPerSession: 5.0,            // $5
    maxCostPerUserPerDay: 20.0,        // $20
    // 调用限制
    maxToolCallsPerSession: 50,
    maxIterationsPerSession: 15,
    // 时长限制
    maxSessionDuration: 1800000,       // 30 分钟
    // 警告阈值
    warningThreshold: 75,              // 75%
    // 自动终止
    autoTerminate: true,
  },
};

/**
 * 开发环境安全配置
 *
 * 宽松的安全策略，适用于开发和测试
 */
export const DEVELOPMENT_SECURITY_CONFIG: SecurityPolicyConfig = {
  audit: {
    enabled: true,
    logFile: 'data/audit/agent-audit-dev.log',
    minSeverity: 'warn',        // 开发环境只记录警告及以上
    logSensitiveData: true,     // 开发环境可以记录敏感数据
    retentionDays: 7,           // 保留 7 天
    maxFileSizeMB: 50,          // 最大 50MB
  },

  network: {
    enabled: true,
    // 开发环境允许更多域名
    allowedDomains: [
      'api.openai.com',
      'api.anthropic.com',
      'api.ollama.ai',
      'github.com',
      'api.github.com',
      'registry.npmjs.org',
      'api.npmjs.org',
      'localhost',
      '127.0.0.1',
      '*.dev',
      '*.test',
      '*.local',
    ],
    blockPrivateIPs: false,     // 开发环境允许私有 IP
    maxRequestSize: 50 * 1024 * 1024,  // 50MB
    maxResponseSize: 100 * 1024 * 1024, // 100MB
    requestTimeout: 60000,      // 60 秒
    rateLimit: 200,             // 每分钟 200 次
    blockedProtocols: ['file', 'ftp'],
    blockedPorts: [22, 25, 465, 587],
  },

  budget: {
    enabled: true,
    maxTokensPerSession: 2000000,      // 2M tokens
    maxTokensPerUserPerDay: 10000000,  // 10M tokens
    maxCostPerSession: 20.0,           // $20
    maxCostPerUserPerDay: 100.0,       // $100
    maxToolCallsPerSession: 200,
    maxIterationsPerSession: 50,
    maxSessionDuration: 7200000,       // 2 小时
    warningThreshold: 85,              // 85%
    autoTerminate: false,
  },
};

/**
 * 最小安全配置
 *
 * 仅启用基本安全检查，适用于受信任环境
 */
export const MINIMAL_SECURITY_CONFIG: SecurityPolicyConfig = {
  audit: {
    enabled: false,
  },

  network: {
    enabled: false,
  },

  budget: {
    enabled: false,
  },
};

/**
 * 根据环境获取安全配置
 */
export function getSecurityConfigForEnvironment(env?: string): SecurityPolicyConfig {
  switch (env) {
    case 'production':
      return PRODUCTION_SECURITY_CONFIG;
    case 'development':
      return DEVELOPMENT_SECURITY_CONFIG;
    case 'minimal':
      return MINIMAL_SECURITY_CONFIG;
    default:
      return DEVELOPMENT_SECURITY_CONFIG;
  }
}

/**
 * 合并自定义配置与默认配置
 */
export function mergeSecurityConfig(
  base: SecurityPolicyConfig,
  custom: Partial<SecurityPolicyConfig>
): SecurityPolicyConfig {
  return {
    audit: { ...base.audit, ...custom.audit },
    network: { ...base.network, ...custom.network },
    budget: { ...base.budget, ...custom.budget },
  };
}
