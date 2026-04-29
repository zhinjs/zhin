/**
 * @zhin.js/ai - TF-IDF 工具过滤
 * 根据用户消息的相关性对候选工具进行评分与筛选
 */

import type { AgentTool, ToolFilterOptions } from '../types.js';

/** 中英文混合分词：按标点/空格切分，保留 ≥2 字符的 token */
const TOKENIZE_RE = /[\s,.:;!?，。：；！？、()（）【】\[\]"'"'「」『』]+/;
export function tokenize(text: string): string[] {
  return text.split(TOKENIZE_RE).filter(w => w.length >= 2);
}

/**
 * 程序化工具过滤 —— TF-IDF 加权的相关性评分
 *
 * 评分层级（基础权重 × IDF 倍率）：
 * 1. keywords 精确匹配: base 1.0 × idf  —— 工具声明的触发关键词
 * 2. tags 匹配:          base 0.5 × idf  —— 工具分类标签
 * 3. 工具名 token 匹配:  base 0.3 × idf  —— 工具名按 `.` `_` `-` 拆词
 * 4. description 关键词:  base 0.15 × idf —— 描述中的词/短语
 *
 * IDF = log(N / df)，N 为工具总数，df 为包含该词的工具数。
 * 高频词（出现在大部分工具中）的 IDF 接近 0，权重被压低；
 * 稀有词（仅少数工具有）的 IDF 较高，权重被放大。
 *
 * @param message      用户消息原文
 * @param tools        候选工具列表
 * @param options      过滤选项
 * @returns            按相关性降序排列的工具子集
 */
export function filterTools(
  message: string,
  tools: AgentTool[],
  options?: ToolFilterOptions,
): AgentTool[] {
  if (tools.length === 0) return [];

  const maxTools = options?.maxTools ?? 10;
  const minScore = options?.minScore ?? 0.1;
  const callerPerm = options?.callerPermissionLevel ?? Infinity;
  const N = tools.length;

  const msgLower = message.toLowerCase();
  const msgTokens = tokenize(msgLower);

  // ── 构建 IDF 索引 ──
  const df = new Map<string, number>();
  const toolTermSets: Map<AgentTool, Set<string>> = new Map();

  for (const tool of tools) {
    const terms = new Set<string>();
    if (tool.keywords) for (const kw of tool.keywords) { if (kw) terms.add(kw.toLowerCase()); }
    if (tool.tags) for (const tag of tool.tags) { if (tag && tag.length > 1) terms.add(tag.toLowerCase()); }
    for (const nt of tool.name.toLowerCase().split(/[._\-]+/)) { if (nt.length > 1) terms.add(nt); }
    for (const w of tokenize(tool.description.toLowerCase())) { terms.add(w); }
    toolTermSets.set(tool, terms);
    for (const t of terms) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }

  const idf = (term: string): number => {
    const docFreq = df.get(term);
    if (!docFreq) return 1.0;
    return Math.max(0.1, Math.log(N / docFreq));
  };

  // ── 评分 ──
  const scored: { tool: AgentTool; score: number }[] = [];

  for (const tool of tools) {
    if (tool.permissionLevel != null && tool.permissionLevel > callerPerm) {
      continue;
    }

    let score = 0;

    // 1. keywords（最高基础权重）
    if (tool.keywords?.length) {
      for (const kw of tool.keywords) {
        if (kw && msgLower.includes(kw.toLowerCase())) {
          score += 1.0 * idf(kw.toLowerCase());
        }
      }
    }

    // 2. tags
    if (tool.tags?.length) {
      for (const tag of tool.tags) {
        if (tag && tag.length > 1 && msgLower.includes(tag.toLowerCase())) {
          score += 0.5 * idf(tag.toLowerCase());
        }
      }
    }

    // 3. 工具名 token
    const nameTokens = tool.name.toLowerCase().split(/[._\-]+/);
    for (const nt of nameTokens) {
      if (nt.length > 1 && msgLower.includes(nt)) {
        score += 0.3 * idf(nt);
      }
    }

    // 4. 描述双向匹配
    const descLower = tool.description.toLowerCase();
    const descTokens = tokenize(descLower);
    for (const dw of descTokens) {
      if (msgLower.includes(dw)) {
        score += 0.15 * idf(dw);
      }
    }
    for (const mw of msgTokens) {
      if (descLower.includes(mw)) {
        score += 0.2 * idf(mw);
      }
    }

    if (score >= minScore) {
      scored.push({ tool, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxTools).map(s => s.tool);
}

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
