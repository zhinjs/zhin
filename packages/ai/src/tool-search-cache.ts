/**
 * Tool Search Cache — 工具搜索缓存
 *
 * 参考 Claude Code 的 memoize + 版本失效模式：
 * 缓存工具描述和过滤结果，避免每次请求都重新排序/过滤。
 *
 * 核心设计：
 *   1. 工具集 hash 变化时自动失效缓存
 *   2. 缓存工具过滤结果（相同消息 + 相同工具集 → 相同结果）
 *   3. LRU 驱逐策略，上限 100 条缓存
 */

import type { AgentTool, ToolFilterOptions } from './types.js';
import { filterTools } from './tool-filter.js';

// ============================================================================
// 常量
// ============================================================================

/** 缓存条目上限 */
const MAX_CACHE_ENTRIES = 100;

// ============================================================================
// 工具集 Hash
// ============================================================================

/**
 * 计算工具集的身份 hash
 *
 * 使用工具名排序后拼接，变化即意味着工具集被修改。
 * 参考 Claude Code 的 getDeferredToolsCacheKey。
 */
export function computeToolSetHash(tools: AgentTool[]): string {
  return tools
    .map(t => t.name)
    .sort()
    .join('|');
}

// ============================================================================
// CachedToolFilter
// ============================================================================

interface CacheEntry {
  result: AgentTool[];
  accessedAt: number;
}

/**
 * 带缓存的工具过滤器
 *
 * 包装 filterTools，对相同的 (messageKey, toolSetHash, options) 复用结果。
 */
export class CachedToolFilter {
  /** 缓存键 → 过滤结果 */
  private cache: Map<string, CacheEntry> = new Map();
  /** 当前工具集 hash */
  private toolSetHash: string = '';

  /**
   * 执行带缓存的过滤
   *
   * @param message 用户消息
   * @param tools 候选工具列表
   * @param options 过滤选项
   * @returns 过滤后的工具列表
   */
  filter(
    message: string,
    tools: AgentTool[],
    options?: ToolFilterOptions,
  ): AgentTool[] {
    // 检查工具集是否变化
    const currentHash = computeToolSetHash(tools);
    if (currentHash !== this.toolSetHash) {
      this.cache.clear();
      this.toolSetHash = currentHash;
    }

    // 构建缓存键
    const cacheKey = this.buildCacheKey(message, options);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      cached.accessedAt = Date.now();
      return cached.result;
    }

    // 执行过滤
    const result = filterTools(message, tools, options);

    // 存入缓存
    this.cache.set(cacheKey, { result, accessedAt: Date.now() });

    // LRU 驱逐
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      this.evictOldest();
    }

    return result;
  }

  /**
   * 手动失效缓存（工具增减时调用）
   */
  invalidate(): void {
    this.cache.clear();
    this.toolSetHash = '';
  }

  /**
   * 当前缓存条目数
   */
  get size(): number {
    return this.cache.size;
  }

  // ── 内部方法 ──

  private buildCacheKey(message: string, options?: ToolFilterOptions): string {
    const msgKey = message.toLowerCase().trim();
    const optKey = options
      ? `${options.callerPermissionLevel ?? ''}_${options.maxTools ?? ''}_${options.minScore ?? ''}`
      : '';
    return `${msgKey}::${optKey}`;
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
