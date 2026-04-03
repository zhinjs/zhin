/**
 * Cost Tracker — 成本追踪系统
 *
 * 参考 Claude Code 的 cost-tracker.ts 设计：
 * 为每次 LLM 调用记录 token 用量和 USD 成本，
 * 按模型分别追踪，支持会话级持久化。
 *
 * 核心设计：
 *   1. 按模型名分别追踪 token 用量和成本
 *   2. 支持缓存 token 计量（cache read / cache creation）
 *   3. 提供格式化输出和统计 API
 *   4. 可选的事件回调机制
 */

import type { Usage } from './types.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 单个模型的 token 用量 */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUSD: number;
  requestCount: number;
}

/** 模型定价配置（每百万 token 的 USD 价格） */
export interface ModelPricing {
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  cacheReadPricePerMToken?: number;
  cacheCreationPricePerMToken?: number;
}

/** 成本追踪快照 */
export interface CostSnapshot {
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalRequests: number;
  modelUsage: Record<string, ModelUsage>;
  /** 会话开始时间 */
  startedAt: number;
  /** 最近一次更新时间 */
  updatedAt: number;
}

/** 成本更新事件 */
export interface CostUpdateEvent {
  model: string;
  usage: Usage;
  costUSD: number;
  snapshot: CostSnapshot;
}

// ============================================================================
// 默认定价表
// ============================================================================

/**
 * 已知模型定价表（USD per million tokens）
 * 数据来源：各 Provider 官方定价页面，实际价格可能变动
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { inputPricePerMToken: 2.5, outputPricePerMToken: 10 },
  'gpt-4o-mini': { inputPricePerMToken: 0.15, outputPricePerMToken: 0.6 },
  'gpt-4-turbo': { inputPricePerMToken: 10, outputPricePerMToken: 30 },
  'gpt-4': { inputPricePerMToken: 30, outputPricePerMToken: 60 },
  'gpt-3.5-turbo': { inputPricePerMToken: 0.5, outputPricePerMToken: 1.5 },
  'o1': { inputPricePerMToken: 15, outputPricePerMToken: 60 },
  'o1-mini': { inputPricePerMToken: 3, outputPricePerMToken: 12 },
  'o3-mini': { inputPricePerMToken: 1.1, outputPricePerMToken: 4.4 },

  // Anthropic
  'claude-opus-4': { inputPricePerMToken: 15, outputPricePerMToken: 75 },
  'claude-sonnet-4': { inputPricePerMToken: 3, outputPricePerMToken: 15 },
  'claude-3.5-sonnet': { inputPricePerMToken: 3, outputPricePerMToken: 15 },
  'claude-3.5-haiku': { inputPricePerMToken: 0.8, outputPricePerMToken: 4 },
  'claude-3-opus': { inputPricePerMToken: 15, outputPricePerMToken: 75 },

  // DeepSeek
  'deepseek-chat': { inputPricePerMToken: 0.14, outputPricePerMToken: 0.28 },
  'deepseek-reasoner': { inputPricePerMToken: 0.55, outputPricePerMToken: 2.19 },

  // 智谱 GLM
  'glm-4': { inputPricePerMToken: 15, outputPricePerMToken: 15 },
  'glm-4-flash': { inputPricePerMToken: 0.1, outputPricePerMToken: 0.1 },

  // Moonshot
  'moonshot-v1-8k': { inputPricePerMToken: 1.7, outputPricePerMToken: 1.7 },
  'moonshot-v1-32k': { inputPricePerMToken: 3.4, outputPricePerMToken: 3.4 },
  'moonshot-v1-128k': { inputPricePerMToken: 8.5, outputPricePerMToken: 8.5 },
};

// ============================================================================
// CostTracker
// ============================================================================

/**
 * 成本追踪器
 *
 * 维护按模型分别的 token 用量和 USD 成本统计。
 * 参考 Claude Code 的中心化状态存储模式。
 */
export class CostTracker {
  private modelUsage: Map<string, ModelUsage> = new Map();
  private customPricing: Map<string, ModelPricing> = new Map();
  private startedAt: number = Date.now();
  private updatedAt: number = Date.now();
  private listeners: ((event: CostUpdateEvent) => void)[] = [];

  /**
   * 注册自定义模型定价
   */
  setModelPricing(model: string, pricing: ModelPricing): void {
    this.customPricing.set(model, pricing);
  }

  /**
   * 获取模型定价（优先自定义，否则查默认表，最后返回 0）
   */
  getModelPricing(model: string): ModelPricing {
    // 精确匹配
    const custom = this.customPricing.get(model);
    if (custom) return custom;

    const defaultPricing = DEFAULT_PRICING[model];
    if (defaultPricing) return defaultPricing;

    // 模糊匹配（前缀）
    for (const [key, pricing] of Object.entries(DEFAULT_PRICING)) {
      if (model.startsWith(key) || key.startsWith(model)) {
        return pricing;
      }
    }

    // 未知模型，返回 0 价格
    return { inputPricePerMToken: 0, outputPricePerMToken: 0 };
  }

  /**
   * 计算单次调用的 USD 成本
   */
  calculateCost(model: string, usage: Usage): number {
    const pricing = this.getModelPricing(model);
    const inputCost = (usage.prompt_tokens / 1_000_000) * pricing.inputPricePerMToken;
    const outputCost = (usage.completion_tokens / 1_000_000) * pricing.outputPricePerMToken;
    return inputCost + outputCost;
  }

  /**
   * 添加一次 LLM 调用的用量
   */
  addUsage(model: string, usage: Usage): number {
    const costUSD = this.calculateCost(model, usage);

    let entry = this.modelUsage.get(model);
    if (!entry) {
      entry = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalCostUSD: 0,
        requestCount: 0,
      };
      this.modelUsage.set(model, entry);
    }

    entry.inputTokens += usage.prompt_tokens;
    entry.outputTokens += usage.completion_tokens;
    entry.totalCostUSD += costUSD;
    entry.requestCount += 1;
    this.updatedAt = Date.now();

    // 通知监听器
    const snapshot = this.getSnapshot();
    const event: CostUpdateEvent = { model, usage, costUSD, snapshot };
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* 忽略监听器错误 */ }
    }

    return costUSD;
  }

  /**
   * 注册成本更新监听器
   * @returns 取消注册函数
   */
  onUpdate(listener: (event: CostUpdateEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  // ── 查询 API ──

  /** 获取总 USD 成本 */
  getTotalCost(): number {
    let total = 0;
    for (const entry of this.modelUsage.values()) {
      total += entry.totalCostUSD;
    }
    return total;
  }

  /** 获取总输入 token 数 */
  getTotalInputTokens(): number {
    let total = 0;
    for (const entry of this.modelUsage.values()) {
      total += entry.inputTokens;
    }
    return total;
  }

  /** 获取总输出 token 数 */
  getTotalOutputTokens(): number {
    let total = 0;
    for (const entry of this.modelUsage.values()) {
      total += entry.outputTokens;
    }
    return total;
  }

  /** 获取总请求次数 */
  getTotalRequests(): number {
    let total = 0;
    for (const entry of this.modelUsage.values()) {
      total += entry.requestCount;
    }
    return total;
  }

  /** 获取特定模型的用量 */
  getModelUsage(model: string): ModelUsage | undefined {
    return this.modelUsage.get(model);
  }

  /** 获取所有模型用量 */
  getAllModelUsage(): Record<string, ModelUsage> {
    const result: Record<string, ModelUsage> = {};
    for (const [model, usage] of this.modelUsage.entries()) {
      result[model] = { ...usage };
    }
    return result;
  }

  /** 获取当前快照 */
  getSnapshot(): CostSnapshot {
    return {
      totalCostUSD: this.getTotalCost(),
      totalInputTokens: this.getTotalInputTokens(),
      totalOutputTokens: this.getTotalOutputTokens(),
      totalTokens: this.getTotalInputTokens() + this.getTotalOutputTokens(),
      totalRequests: this.getTotalRequests(),
      modelUsage: this.getAllModelUsage(),
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
    };
  }

  // ── 格式化 ──

  /**
   * 格式化成本显示
   * 参考 Claude Code 的 formatCost
   */
  static formatCost(cost: number, maxDecimalPlaces = 4): string {
    if (cost >= 0.5) return `$${cost.toFixed(2)}`;
    if (cost === 0) return '$0.00';
    return `$${cost.toFixed(maxDecimalPlaces)}`;
  }

  /**
   * 格式化 token 数量
   */
  static formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return `${tokens}`;
  }

  /**
   * 生成格式化的成本摘要
   */
  formatSummary(): string {
    const lines: string[] = [];
    const snapshot = this.getSnapshot();

    lines.push(`总成本: ${CostTracker.formatCost(snapshot.totalCostUSD)}`);
    lines.push(`总请求: ${snapshot.totalRequests}`);
    lines.push(
      `总 token: ${CostTracker.formatTokens(snapshot.totalTokens)} ` +
      `(输入 ${CostTracker.formatTokens(snapshot.totalInputTokens)}, ` +
      `输出 ${CostTracker.formatTokens(snapshot.totalOutputTokens)})`,
    );

    if (this.modelUsage.size > 1) {
      lines.push('');
      lines.push('按模型:');
      for (const [model, usage] of this.modelUsage.entries()) {
        lines.push(
          `  ${model}: ${CostTracker.formatCost(usage.totalCostUSD)} ` +
          `(${usage.requestCount} 次, ` +
          `输入 ${CostTracker.formatTokens(usage.inputTokens)}, ` +
          `输出 ${CostTracker.formatTokens(usage.outputTokens)})`,
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * 重置所有统计
   */
  reset(): void {
    this.modelUsage.clear();
    this.startedAt = Date.now();
    this.updatedAt = Date.now();
  }
}
