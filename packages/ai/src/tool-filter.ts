/**
 * @zhin.js/ai - TF-IDF 工具过滤
 * 根据用户消息的相关性对候选工具进行评分与筛选
 */

import type { AgentTool, ToolFilterOptions } from './types.js';

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
