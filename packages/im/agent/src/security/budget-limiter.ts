/**
 * Token/Cost 预算限制系统
 *
 * 控制 AI Agent 的资源使用，防止：
 * - Token 滥用
 * - 成本超支
 * - 资源耗尽
 *
 */

import { getPlugin } from '@zhin.js/core';

// ── 预算配置 ──────────────────────────────────────────────────────────

export interface BudgetConfig {
  /** 是否启用预算限制 */
  enabled: boolean;
  /** 每会话最大 Token 数 */
  maxTokensPerSession?: number;
  /** 每用户每天最大 Token 数 */
  maxTokensPerUserPerDay?: number;
  /** 每会话最大成本（美元） */
  maxCostPerSession?: number;
  /** 每用户每天最大成本（美元） */
  maxCostPerUserPerDay?: number;
  /** 每会话最大工具调用次数 */
  maxToolCallsPerSession?: number;
  /** 每会话最大迭代次数 */
  maxIterationsPerSession?: number;
  /** 每会话最大持续时间（毫秒） */
  maxSessionDuration?: number;
  /** 警告阈值（百分比） */
  warningThreshold?: number;
  /** 是否在达到限制时自动结束会话 */
  autoTerminate?: boolean;
}

const DEFAULT_CONFIG: BudgetConfig = {
  enabled: true,
  maxTokensPerSession: 1000000,        // 1M tokens
  maxTokensPerUserPerDay: 5000000,     // 5M tokens
  maxCostPerSession: 10.0,             // $10
  maxCostPerUserPerDay: 50.0,          // $50
  maxToolCallsPerSession: 100,
  maxIterationsPerSession: 20,
  maxSessionDuration: 3600000,         // 1 小时
  warningThreshold: 80,                // 80%
  autoTerminate: false,
};

// ── Token 使用记录 ────────────────────────────────────────────────────

export interface TokenUsage {
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 估算成本（美元） */
  estimatedCost: number;
}

// ── 会话预算状态 ──────────────────────────────────────────────────────

export interface SessionBudget {
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId?: string;
  /** 开始时间 */
  startTime: number;
  /** Token 使用情况 */
  tokenUsage: TokenUsage;
  /** 工具调用次数 */
  toolCallCount: number;
  /** 迭代次数 */
  iterationCount: number;
  /** 是否已达到限制 */
  limitReached: boolean;
  /** 达到的限制类型 */
  limitType?: string;
  /** 警告已发送 */
  warningsSent: Set<string>;
}

// ── 预算检查结果 ──────────────────────────────────────────────────────

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  /** 当前使用情况 */
  current?: {
    tokens: number;
    cost: number;
    toolCalls: number;
    iterations: number;
    duration: number;
  };
  /** 限制情况 */
  limits?: {
    maxTokens?: number;
    maxCost?: number;
    maxToolCalls?: number;
    maxIterations?: number;
    maxDuration?: number;
  };
  /** 是否为警告 */
  isWarning?: boolean;
}

// ── 预算限制器类 ──────────────────────────────────────────────────────

export class BudgetLimiter {
  private config: BudgetConfig;
  private sessions: Map<string, SessionBudget> = new Map();
  private dailyUsage: Map<string, TokenUsage> = new Map(); // userId -> usage
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private static readonly MAX_DAILY_ENTRIES = 10000;

  constructor(config: Partial<BudgetConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 定期清理过期会话
    this.cleanupTimer = setInterval(() => this.cleanup(), 300000);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * 创建新会话预算
   */
  createSession(sessionId: string, userId?: string): SessionBudget {
    const budget: SessionBudget = {
      sessionId,
      userId,
      startTime: Date.now(),
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
      toolCallCount: 0,
      iterationCount: 0,
      limitReached: false,
      warningsSent: new Set(),
    };

    this.sessions.set(sessionId, budget);
    return budget;
  }

  /**
   * 获取会话预算
   */
  getSession(sessionId: string): SessionBudget | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 记录 Token 使用
   */
  recordTokenUsage(sessionId: string, usage: TokenUsage): BudgetCheckResult {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return { allowed: true };
    }

    // 更新会话使用情况
    session.tokenUsage.inputTokens += usage.inputTokens;
    session.tokenUsage.outputTokens += usage.outputTokens;
    session.tokenUsage.totalTokens += usage.totalTokens;
    session.tokenUsage.estimatedCost += usage.estimatedCost;

    // 更新每日使用情况
    if (session.userId) {
      this.updateDailyUsage(session.userId, usage);
    }

    // 检查限制
    return this.checkBudget(session);
  }

  /**
   * 记录工具调用
   */
  recordToolCall(sessionId: string): BudgetCheckResult {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return { allowed: true };
    }

    session.toolCallCount++;
    return this.checkBudget(session);
  }

  /**
   * 记录迭代
   */
  recordIteration(sessionId: string): BudgetCheckResult {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return { allowed: true };
    }

    session.iterationCount++;
    return this.checkBudget(session);
  }

  /**
   * 检查预算限制
   */
  private checkBudget(session: SessionBudget): BudgetCheckResult {
    const now = Date.now();
    const duration = now - session.startTime;

    // 构建当前使用情况
    const current = {
      tokens: session.tokenUsage.totalTokens,
      cost: session.tokenUsage.estimatedCost,
      toolCalls: session.toolCallCount,
      iterations: session.iterationCount,
      duration,
    };

    // 构建限制情况
    const limits = {
      maxTokens: this.config.maxTokensPerSession,
      maxCost: this.config.maxCostPerSession,
      maxToolCalls: this.config.maxToolCallsPerSession,
      maxIterations: this.config.maxIterationsPerSession,
      maxDuration: this.config.maxSessionDuration,
    };

    // 检查每日成本限制（优先检查成本，因为成本更敏感）
    if (session.userId && this.config.maxCostPerUserPerDay) {
      const dailyUsage = this.dailyUsage.get(session.userId);
      if (dailyUsage && dailyUsage.estimatedCost >= this.config.maxCostPerUserPerDay) {
        session.limitReached = true;
        session.limitType = 'dailyCost';
        return {
          allowed: false,
          reason: `已达到每日成本限制 ($${this.config.maxCostPerUserPerDay})`,
          current,
          limits,
        };
      }
    }

    // 检查会话成本限制
    if (this.config.maxCostPerSession && session.tokenUsage.estimatedCost >= this.config.maxCostPerSession) {
      session.limitReached = true;
      session.limitType = 'sessionCost';
      return {
        allowed: false,
        reason: `已达到会话成本限制 ($${this.config.maxCostPerSession})`,
        current,
        limits,
      };
    }

    // 检查每日 Token 限制
    if (session.userId && this.config.maxTokensPerUserPerDay) {
      const dailyUsage = this.dailyUsage.get(session.userId);
      if (dailyUsage && dailyUsage.totalTokens >= this.config.maxTokensPerUserPerDay) {
        session.limitReached = true;
        session.limitType = 'dailyTokens';
        return {
          allowed: false,
          reason: `已达到每日 Token 使用限制 (${this.config.maxTokensPerUserPerDay})`,
          current,
          limits,
        };
      }
    }

    // 检查会话 Token 限制
    if (this.config.maxTokensPerSession && session.tokenUsage.totalTokens >= this.config.maxTokensPerSession) {
      session.limitReached = true;
      session.limitType = 'sessionTokens';
      return {
        allowed: false,
        reason: `已达到会话 Token 使用限制 (${this.config.maxTokensPerSession})`,
        current,
        limits,
      };
    }

    // 检查工具调用限制
    if (this.config.maxToolCallsPerSession && session.toolCallCount >= this.config.maxToolCallsPerSession) {
      session.limitReached = true;
      session.limitType = 'toolCalls';
      return {
        allowed: false,
        reason: `已达到工具调用次数限制 (${this.config.maxToolCallsPerSession})`,
        current,
        limits,
      };
    }

    // 检查迭代限制
    if (this.config.maxIterationsPerSession && session.iterationCount >= this.config.maxIterationsPerSession) {
      session.limitReached = true;
      session.limitType = 'iterations';
      return {
        allowed: false,
        reason: `已达到迭代次数限制 (${this.config.maxIterationsPerSession})`,
        current,
        limits,
      };
    }

    // 检查会话时长限制
    if (this.config.maxSessionDuration && duration >= this.config.maxSessionDuration) {
      session.limitReached = true;
      session.limitType = 'duration';
      return {
        allowed: false,
        reason: `已达到会话时长限制 (${this.config.maxSessionDuration / 60000} 分钟)`,
        current,
        limits,
      };
    }

    // 检查警告阈值
    const warnings: string[] = [];
    const threshold = (this.config.warningThreshold || 80) / 100;

    if (this.config.maxTokensPerSession) {
      const usageRatio = session.tokenUsage.totalTokens / this.config.maxTokensPerSession;
      if (usageRatio >= threshold && !session.warningsSent.has('tokens')) {
        warnings.push(`Token 使用已达 ${Math.round(usageRatio * 100)}%`);
        session.warningsSent.add('tokens');
      }
    }

    if (this.config.maxCostPerSession) {
      const usageRatio = session.tokenUsage.estimatedCost / this.config.maxCostPerSession;
      if (usageRatio >= threshold && !session.warningsSent.has('cost')) {
        warnings.push(`成本已达 ${Math.round(usageRatio * 100)}%`);
        session.warningsSent.add('cost');
      }
    }

    if (warnings.length > 0) {
      return {
        allowed: true,
        reason: warnings.join('; '),
        current,
        limits,
        isWarning: true,
      };
    }

    return { allowed: true, current, limits };
  }

  /**
   * 更新每日使用情况
   */
  private updateDailyUsage(userId: string, usage: TokenUsage): void {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const key = `${userId}:${today}`;

    let daily = this.dailyUsage.get(key);
    if (!daily) {
      daily = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 };
      this.dailyUsage.set(key, daily);
    }

    daily.inputTokens += usage.inputTokens;
    daily.outputTokens += usage.outputTokens;
    daily.totalTokens += usage.totalTokens;
    daily.estimatedCost += usage.estimatedCost;
  }

  /**
   * 清理过期会话和每日记录
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 小时

    // 清理过期会话
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.startTime > maxAge) {
        this.sessions.delete(sessionId);
      }
    }

    // 清理过期的每日记录
    const today = new Date().toISOString().split('T')[0];
    for (const key of this.dailyUsage.keys()) {
      if (!key.endsWith(today)) {
        this.dailyUsage.delete(key);
      }
    }

    // 防止当日条目无限增长
    if (this.dailyUsage.size > BudgetLimiter.MAX_DAILY_ENTRIES) {
      const excess = this.dailyUsage.size - BudgetLimiter.MAX_DAILY_ENTRIES;
      let removed = 0;
      for (const key of this.dailyUsage.keys()) {
        if (removed >= excess) break;
        this.dailyUsage.delete(key);
        removed++;
      }
    }
  }

  /**
   * 结束会话
   */
  endSession(sessionId: string): SessionBudget | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
    }
    return session;
  }

  /**
   * 获取会话统计
   */
  getSessionStats(sessionId: string): {
    tokenUsage: TokenUsage;
    toolCallCount: number;
    iterationCount: number;
    duration: number;
    limits: Record<string, number | undefined>;
  } | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    return {
      tokenUsage: { ...session.tokenUsage },
      toolCallCount: session.toolCallCount,
      iterationCount: session.iterationCount,
      duration: Date.now() - session.startTime,
      limits: {
        maxTokens: this.config.maxTokensPerSession,
        maxCost: this.config.maxCostPerSession,
        maxToolCalls: this.config.maxToolCallsPerSession,
        maxIterations: this.config.maxIterationsPerSession,
        maxDuration: this.config.maxSessionDuration,
      },
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): BudgetConfig {
    return { ...this.config };
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.sessions.clear();
    this.dailyUsage.clear();
  }
}

// ── 全局预算限制器实例 ────────────────────────────────────────────────

let globalBudgetLimiter: BudgetLimiter | null = null;

/**
 * 获取全局预算限制器实例
 */
export function getBudgetLimiter(): BudgetLimiter {
  if (!globalBudgetLimiter) {
    try {
      const plugin = getPlugin();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (plugin.root?.inject('config') as any)?.ai?.agent?.budget;
      globalBudgetLimiter = new BudgetLimiter(config);
    } catch {
      globalBudgetLimiter = new BudgetLimiter();
    }
  }
  return globalBudgetLimiter;
}

/**
 * 初始化预算限制器
 */
export function initBudgetLimiter(config: Partial<BudgetConfig>): BudgetLimiter {
  globalBudgetLimiter = new BudgetLimiter(config);
  return globalBudgetLimiter;
}

/** 重置全局预算限制器（用于测试隔离） */
export function resetBudgetLimiter(): void {
  globalBudgetLimiter = null;
}

/**
 * 检查预算限制
 */
export function checkBudgetLimit(sessionId: string, type: 'tokens' | 'toolCall' | 'iteration', usage?: TokenUsage): BudgetCheckResult {
  const limiter = getBudgetLimiter();

  switch (type) {
    case 'tokens':
      if (!usage) return { allowed: true };
      return limiter.recordTokenUsage(sessionId, usage);
    case 'toolCall':
      return limiter.recordToolCall(sessionId);
    case 'iteration':
      return limiter.recordIteration(sessionId);
    default:
      return { allowed: true };
  }
}
