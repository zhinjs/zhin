/**
 * Agent 安全策略模块
 *
 * 提供多层安全防护：
 * - 执行策略（exec-policy）：命令执行安全
 * - 文件策略（file-policy）：文件访问安全
 * - 网络策略（network-policy）：网络访问安全
 * - 预算限制（budget-limiter）：资源使用限制
 * - 审计日志（audit-logger）：安全事件追踪
 * - 沙箱环境（sandbox）：进程隔离和资源限制
 * - 增强沙箱（sandbox-enhanced）：更细粒度的安全控制
 * - 异常检测（anomaly-detection）：行为模式分析和异常检测
 */

// ── 核心安全策略 ──────────────────────────────────────────────────────

export * from './file-policy.js';
export * from './exec-policy.js';
export * from './network-policy.js';
export * from './budget-limiter.js';
export * from './audit-logger.js';
export * from './bash-tool-context.js';
export * from './owner-approve-always-store.js';
export * from './sandbox.js';
export * from './sandbox-enhanced.js';
export * from './anomaly-detection.js';
export * from './file-role-policy.js';
export * from './dangerous-tool-policy.js';

// ── 安全策略工厂 ──────────────────────────────────────────────────────

import type { AuditLoggerConfig } from './audit-logger.js';
import { AuditLogger, initAuditLogger, getAuditLogger } from './audit-logger.js';
import type { NetworkPolicyConfig } from './network-policy.js';
import { NetworkPolicy, initNetworkPolicy, getNetworkPolicy } from './network-policy.js';
import type { BudgetConfig } from './budget-limiter.js';
import { BudgetLimiter, initBudgetLimiter, getBudgetLimiter } from './budget-limiter.js';

export interface SecurityPolicyConfig {
  audit?: Partial<AuditLoggerConfig>;
  network?: Partial<NetworkPolicyConfig>;
  budget?: Partial<BudgetConfig>;
}

/**
 * 初始化所有安全策略
 */
export function initSecurityPolicies(config: SecurityPolicyConfig = {}): {
  auditLogger: AuditLogger;
  networkPolicy: NetworkPolicy;
  budgetLimiter: BudgetLimiter;
} {
  const auditLogger = initAuditLogger(config.audit || {});
  const networkPolicy = initNetworkPolicy(config.network || {});
  const budgetLimiter = initBudgetLimiter(config.budget || {});

  return { auditLogger, networkPolicy, budgetLimiter };
}

/**
 * 获取安全策略状态
 */
export function getSecurityPolicyStatus(): {
  audit: { enabled: boolean; eventCount: number };
  network: { enabled: boolean; rulesCount: number };
  budget: { enabled: boolean; activeSessions: number };
} {
  try {
    const audit = getAuditLogger();
    const network = getNetworkPolicy();
    const budget = getBudgetLimiter();

    return {
      audit: {
        enabled: audit.getConfig().enabled,
        eventCount: audit.getStats().totalEvents,
      },
      network: {
        enabled: network.getConfig().enabled,
        rulesCount: (network.getConfig().allowedDomains?.length || 0) +
                   (network.getConfig().blockedDomains?.length || 0),
      },
      budget: {
        enabled: budget.getConfig().enabled,
        activeSessions: 0,
      },
    };
  } catch {
    return {
      audit: { enabled: false, eventCount: 0 },
      network: { enabled: false, rulesCount: 0 },
      budget: { enabled: false, activeSessions: 0 },
    };
  }
}
