/**
 * Session Compaction — 会话压缩
 * 核心理念：
 *   1. Token 估算：用 chars/4 粗略估算 token 数
 *   2. 分块（Chunk）：按 token 预算将消息分成多块
 *   3. 渐进式摘要：对每块分别生成摘要，再合并
 *   4. 安全裕度：估算偏低时留 20% buffer
 *   5. 降级策略：摘要失败时使用更粗糙的摘要
 */

import { Logger } from '@zhin.js/logger';
import type { AIProvider, ChatMessage } from '../types.js';
import { microCompactMessages } from './micro-compact.js';
import type { MicroCompactOptions } from './micro-compact.js';
import { estimateTokens, estimateMessagesTokens } from './token-counter.js';

const logger = new Logger(null, 'Compaction');

// ============================================================================
// 常量
// ============================================================================

/** 默认上下文窗口大小（tokens） */
export const DEFAULT_CONTEXT_TOKENS = 128_000;

/** 上下文窗口最低阈值 */
export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;

/** 上下文窗口警告阈值 */
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;

/** 基础分块比例 — 每块最多占上下文的 40% */
export const BASE_CHUNK_RATIO = 0.4;

/** 最小分块比例 */
export const MIN_CHUNK_RATIO = 0.15;

/** 安全裕度系数 — 20% buffer 补偿 estimateTokens 的低估 */
export const SAFETY_MARGIN = 1.2;

/** 默认摘要回退文本 */
const DEFAULT_SUMMARY_FALLBACK = '无历史记录。';

/** 摘要合并指令 */
const MERGE_SUMMARIES_INSTRUCTIONS =
  '将下面这些部分摘要合并为一份连贯的完整摘要。保留关键决定、TODO、未解决的问题和所有约束。';

// ============================================================================
// 分块
// ============================================================================

/**
 * 按 token 份额拆分消息
 */
export function splitMessagesByTokenShare(
  messages: ChatMessage[],
  parts = 2,
): ChatMessage[][] {
  if (messages.length === 0) return [];
  const normalizedParts = Math.min(Math.max(1, Math.floor(parts)), messages.length);
  if (normalizedParts <= 1) return [messages];

  const totalTokens = estimateMessagesTokens(messages);
  const targetTokens = totalTokens / normalizedParts;
  const chunks: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const msgTokens = estimateTokens(message);
    if (
      chunks.length < normalizedParts - 1 &&
      current.length > 0 &&
      currentTokens + msgTokens > targetTokens
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(message);
    currentTokens += msgTokens;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * 按最大 token 数拆分消息
 */
export function chunkMessagesByMaxTokens(
  messages: ChatMessage[],
  maxTokens: number,
): ChatMessage[][] {
  if (messages.length === 0) return [];

  const effectiveMax = Math.max(1, Math.floor(maxTokens / SAFETY_MARGIN));
  const chunks: ChatMessage[][] = [];
  let currentChunk: ChatMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const msgTokens = estimateTokens(message);
    if (currentChunk.length > 0 && currentTokens + msgTokens > effectiveMax) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
    currentChunk.push(message);
    currentTokens += msgTokens;

    // 超大单条消息也要拆
    if (msgTokens > effectiveMax) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
}

/**
 * 计算自适应分块比例
 * 消息越大，分块比例越小，避免超出模型限制
 */
export function computeAdaptiveChunkRatio(
  messages: ChatMessage[],
  contextWindow: number,
): number {
  if (messages.length === 0) return BASE_CHUNK_RATIO;

  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;
  const safeAvgTokens = avgTokens * SAFETY_MARGIN;
  const avgRatio = safeAvgTokens / contextWindow;

  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}

// ============================================================================
// 上下文窗口保护
// ============================================================================

export type ContextWindowSource = 'config' | 'model' | 'default';

export interface ContextWindowInfo {
  tokens: number;
  source: ContextWindowSource;
}

export interface ContextWindowGuardResult extends ContextWindowInfo {
  shouldWarn: boolean;
  shouldBlock: boolean;
}

/**
 * 解析上下文窗口大小
 */
export function resolveContextWindowTokens(
  configTokens?: number,
  modelContextWindow?: number,
): ContextWindowInfo {
  if (configTokens && configTokens > 0) {
    return { tokens: Math.floor(configTokens), source: 'config' };
  }
  if (modelContextWindow && modelContextWindow > 0) {
    return { tokens: Math.floor(modelContextWindow), source: 'model' };
  }
  return { tokens: DEFAULT_CONTEXT_TOKENS, source: 'default' };
}

/**
 * 评估上下文窗口安全性
 */
export function evaluateContextWindowGuard(
  info: ContextWindowInfo,
): ContextWindowGuardResult {
  const tokens = Math.max(0, Math.floor(info.tokens));
  return {
    ...info,
    tokens,
    shouldWarn: tokens > 0 && tokens < CONTEXT_WINDOW_WARN_BELOW_TOKENS,
    shouldBlock: tokens > 0 && tokens < CONTEXT_WINDOW_HARD_MIN_TOKENS,
  };
}

// ============================================================================
// 摘要生成
// ============================================================================

/**
 * 通过 LLM 对消息进行摘要
 */
async function generateSummary(
  provider: AIProvider,
  messages: ChatMessage[],
  maxChunkTokens: number,
  previousSummary?: string,
  customInstructions?: string,
): Promise<string> {
  const conversation = messages.map(m => {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `[${role}] ${content}`;
  }).join('\n');

  let systemPrompt = `You are a conversation summarization assistant. Compress the following conversation into a concise summary. Keep:
- Key decisions and conclusions
- Unfinished TODOs and open questions
- Important user preferences and constraints
- Core topics discussed

The summary should be brief but informative so that later turns can quickly recover context.`;

  if (customInstructions) {
    systemPrompt += `\n\nAdditional instructions: ${customInstructions}`;
  }

  let userContent = '';
  if (previousSummary) {
    userContent += `Previous summary:\n${previousSummary}\n\n`;
  }
  userContent += `New conversation:\n${conversation}\n\nGenerate the updated full summary.`;

  try {
    const response = await provider.chat({
      model: provider.models[0],
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });
    const result = response.choices?.[0]?.message?.content;
    return typeof result === 'string' ? result : DEFAULT_SUMMARY_FALLBACK;
  } catch (e: any) {
    logger.warn(`摘要生成失败: ${e.message}`);
    return DEFAULT_SUMMARY_FALLBACK;
  }
}

/**
 * 对消息分块摘要，支持降级
 */
async function summarizeChunks(params: {
  provider: AIProvider;
  messages: ChatMessage[];
  maxChunkTokens: number;
  previousSummary?: string;
  customInstructions?: string;
}): Promise<string> {
  if (params.messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  const chunks = chunkMessagesByMaxTokens(params.messages, params.maxChunkTokens);
  let summary = params.previousSummary;

  for (const chunk of chunks) {
    summary = await generateSummary(
      params.provider,
      chunk,
      params.maxChunkTokens,
      summary,
      params.customInstructions,
    );
  }

  return summary ?? DEFAULT_SUMMARY_FALLBACK;
}

/**
 * 带降级的摘要生成
 *
 * 完整摘要失败时，尝试排除超大消息再摘要
 */
export async function summarizeWithFallback(params: {
  provider: AIProvider;
  messages: ChatMessage[];
  maxChunkTokens: number;
  contextWindow: number;
  previousSummary?: string;
  customInstructions?: string;
}): Promise<string> {
  if (params.messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  // 尝试完整摘要
  try {
    return await summarizeChunks(params);
  } catch (fullError: any) {
    logger.warn(`完整摘要失败，尝试部分摘要: ${fullError.message}`);
  }

  // 降级：排除超大消息
  const smallMessages: ChatMessage[] = [];
  const oversizedNotes: string[] = [];

  for (const msg of params.messages) {
    const tokens = estimateTokens(msg) * SAFETY_MARGIN;
    if (tokens > params.contextWindow * 0.5) {
      oversizedNotes.push(
        `[大型 ${msg.role} 消息 (~${Math.round(tokens / 1000)}K tokens) 已从摘要中省略]`,
      );
    } else {
      smallMessages.push(msg);
    }
  }

  if (smallMessages.length > 0) {
    try {
      const partial = await summarizeChunks({ ...params, messages: smallMessages });
      const notes = oversizedNotes.length > 0 ? `\n\n${oversizedNotes.join('\n')}` : '';
      return partial + notes;
    } catch (partialError: any) {
      logger.warn(`部分摘要也失败: ${partialError.message}`);
    }
  }

  // 最终降级
  return `上下文包含 ${params.messages.length} 条消息（${oversizedNotes.length} 条超大）。由于大小限制，摘要不可用。`;
}

/**
 * 分阶段摘要 — 先将消息拆为多段分别摘要，再合并
 */
export async function summarizeInStages(params: {
  provider: AIProvider;
  messages: ChatMessage[];
  maxChunkTokens: number;
  contextWindow: number;
  previousSummary?: string;
  customInstructions?: string;
  parts?: number;
}): Promise<string> {
  const { messages } = params;
  if (messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  const parts = Math.min(Math.max(1, params.parts ?? 2), messages.length);
  const totalTokens = estimateMessagesTokens(messages);

  // 消息太少，或 token 没超限，直接走单次摘要
  if (parts <= 1 || messages.length < 4 || totalTokens <= params.maxChunkTokens) {
    return summarizeWithFallback(params);
  }

  const splits = splitMessagesByTokenShare(messages, parts).filter(c => c.length > 0);
  if (splits.length <= 1) return summarizeWithFallback(params);

  // 每段分别摘要
  const partialSummaries: string[] = [];
  for (const chunk of splits) {
    partialSummaries.push(
      await summarizeWithFallback({
        ...params,
        messages: chunk,
        previousSummary: undefined,
      }),
    );
  }

  if (partialSummaries.length === 1) return partialSummaries[0];

  // 合并多段摘要
  const summaryMessages: ChatMessage[] = partialSummaries.map(s => ({
    role: 'user' as const,
    content: s,
  }));

  const mergeInstructions = params.customInstructions
    ? `${MERGE_SUMMARIES_INSTRUCTIONS}\n\n额外要求：${params.customInstructions}`
    : MERGE_SUMMARIES_INSTRUCTIONS;

  return summarizeWithFallback({
    ...params,
    messages: summaryMessages,
    customInstructions: mergeInstructions,
  });
}

// ============================================================================
// 历史剪裁
// ============================================================================

export interface PruneResult {
  /** 保留的消息 */
  messages: ChatMessage[];
  /** 被丢弃的消息 */
  droppedMessages: ChatMessage[];
  /** 丢弃的块数 */
  droppedChunks: number;
  /** 丢弃的消息数 */
  droppedCount: number;
  /** 丢弃的 token 数 */
  droppedTokens: number;
  /** 保留的 token 数 */
  keptTokens: number;
  /** 预算 token 数 */
  budgetTokens: number;
}

/**
 * 剪裁历史消息，使其不超过上下文预算
 *
 * 策略：从最旧的消息开始丢弃，直到 token 总量在预算内
 */
export function pruneHistoryForContext(params: {
  messages: ChatMessage[];
  maxContextTokens: number;
  maxHistoryShare?: number;
  parts?: number;
}): PruneResult {
  const maxHistoryShare = params.maxHistoryShare ?? 0.5;
  const budgetTokens = Math.max(1, Math.floor(params.maxContextTokens * maxHistoryShare));
  let keptMessages = params.messages;
  const allDropped: ChatMessage[] = [];
  let droppedChunks = 0;
  let droppedCount = 0;
  let droppedTokens = 0;

  const parts = Math.min(Math.max(1, params.parts ?? 2), keptMessages.length);

  while (keptMessages.length > 0 && estimateMessagesTokens(keptMessages) > budgetTokens) {
    const chunks = splitMessagesByTokenShare(keptMessages, parts);
    if (chunks.length <= 1) break;

    const [dropped, ...rest] = chunks;
    keptMessages = rest.flat();
    droppedChunks += 1;
    droppedCount += dropped.length;
    droppedTokens += estimateMessagesTokens(dropped);
    allDropped.push(...dropped);
  }

  return {
    messages: keptMessages,
    droppedMessages: allDropped,
    droppedChunks,
    droppedCount,
    droppedTokens,
    keptTokens: estimateMessagesTokens(keptMessages),
    budgetTokens,
  };
}

// ============================================================================
// /compact 命令 — 主动压缩当前会话
// ============================================================================

/**
 * 对给定消息列表执行一次就地压缩，返回压缩后的摘要和保留消息
 */
export async function compactSession(params: {
  provider: AIProvider;
  messages: ChatMessage[];
  contextWindow?: number;
  keepRecentCount?: number;
}): Promise<{
  summary: string;
  keptMessages: ChatMessage[];
  compactedCount: number;
  savedTokens: number;
}> {
  const contextWindow = params.contextWindow ?? DEFAULT_CONTEXT_TOKENS;
  const keepRecentCount = params.keepRecentCount ?? 6;
  const messages = params.messages;

  if (messages.length <= keepRecentCount) {
    return {
      summary: '',
      keptMessages: messages,
      compactedCount: 0,
      savedTokens: 0,
    };
  }

  // 保留最近 N 条，其余摘要
  const toCompact = messages.slice(0, messages.length - keepRecentCount);
  const toKeep = messages.slice(messages.length - keepRecentCount);
  const beforeTokens = estimateMessagesTokens(toCompact);

  const maxChunkTokens = Math.floor(contextWindow * computeAdaptiveChunkRatio(toCompact, contextWindow));
  const summary = await summarizeInStages({
    provider: params.provider,
    messages: toCompact,
    maxChunkTokens,
    contextWindow,
  });

  return {
    summary,
    keptMessages: toKeep,
    compactedCount: toCompact.length,
    savedTokens: beforeTokens - estimateTokens({ role: 'system', content: summary }),
  };
}

// ============================================================================
// 三级压缩管线（参考 Claude Code auto-compact 模式）
// ============================================================================

/** 自动压缩缓冲 token 数 */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

/** 压缩后恢复注入的最大 token 预算 */
export const POST_COMPACT_TOKEN_BUDGET = 50_000;

/** 连续压缩失败断路器上限 */
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

/**
 * 自动压缩追踪状态
 * 参考 Claude Code 的 AutoCompactTrackingState
 */
export interface AutoCompactTrackingState {
  /** 本轮是否已完成压缩 */
  compacted: boolean;
  /** 当前轮次计数 */
  turnCounter: number;
  /** 连续压缩失败次数 */
  consecutiveFailures: number;
}

/**
 * 自动压缩结果
 */
export interface AutoCompactResult {
  /** 是否执行了压缩 */
  wasCompacted: boolean;
  /** 压缩后的消息列表 */
  messages: ChatMessage[];
  /** 总共节省的 token 数 */
  savedTokens: number;
  /** micro-compact 节省的 token 数 */
  microSavedTokens: number;
  /** auto-compact 节省的 token 数 */
  autoSavedTokens: number;
  /** 摘要文本（如果执行了 auto-compact） */
  summary?: string;
}

/**
 * 创建自动压缩追踪状态
 */
export function createAutoCompactTracking(): AutoCompactTrackingState {
  return { compacted: false, turnCounter: 0, consecutiveFailures: 0 };
}

/**
 * 判断是否应该执行自动压缩
 */
export function shouldAutoCompact(
  messages: ChatMessage[],
  contextWindow: number,
  tracking?: AutoCompactTrackingState,
): boolean {
  // 断路器
  if (tracking && tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    logger.warn(`连续 ${tracking.consecutiveFailures} 次压缩失败，断路器开启，跳过压缩`);
    return false;
  }

  const totalTokens = estimateMessagesTokens(messages);
  const threshold = contextWindow - AUTOCOMPACT_BUFFER_TOKENS;

  return totalTokens > threshold;
}

/**
 * 三级渐进压缩管线
 *
 * Level 1: Micro-Compact — 清理旧工具结果（无 LLM 调用）
 * Level 2: Auto-Compact — LLM 摘要 + 保留近期消息
 * Level 3: 参见 session-memory-compact.ts（持久化关键发现）
 *
 * 参考 Claude Code 的 autoCompactIfNeeded
 */
export async function autoCompactIfNeeded(params: {
  provider: AIProvider;
  messages: ChatMessage[];
  contextWindow?: number;
  tracking?: AutoCompactTrackingState;
  microCompactOptions?: MicroCompactOptions;
  keepRecentCount?: number;
}): Promise<AutoCompactResult> {
  const contextWindow = params.contextWindow ?? DEFAULT_CONTEXT_TOKENS;
  const tracking = params.tracking;
  let messages = params.messages;
  let microSavedTokens = 0;
  let autoSavedTokens = 0;

  // ── Level 1: Micro-Compact ──
  // 轻量级清理，无 LLM 调用
  const microResult = microCompactMessages(messages, {
    tokenThreshold: Math.floor(contextWindow * 0.6),
    ...params.microCompactOptions,
  });

  if (microResult.didCompact) {
    messages = microResult.messages;
    microSavedTokens = microResult.savedTokens;
    logger.info(
      `Micro-compact 清理了 ${microResult.clearedCount} 条工具结果，节省约 ${microResult.savedTokens} tokens`,
    );
  }

  // 检查 micro-compact 后是否仍需 auto-compact
  if (!shouldAutoCompact(messages, contextWindow, tracking)) {
    return {
      wasCompacted: microResult.didCompact,
      messages,
      savedTokens: microSavedTokens,
      microSavedTokens,
      autoSavedTokens: 0,
    };
  }

  // ── Level 2: Auto-Compact ──
  // LLM 摘要压缩
  try {
    const result = await compactSession({
      provider: params.provider,
      messages,
      contextWindow,
      keepRecentCount: params.keepRecentCount,
    });

    autoSavedTokens = result.savedTokens;

    // 构建压缩后的消息列表
    const compactedMessages: ChatMessage[] = [];
    if (result.summary) {
      compactedMessages.push({
        role: 'system',
        content: `[会话历史摘要]\n${result.summary}`,
      });
    }
    compactedMessages.push(...result.keptMessages);

    if (tracking) {
      tracking.compacted = true;
      tracking.consecutiveFailures = 0;
    }

    logger.info(
      `Auto-compact 压缩了 ${result.compactedCount} 条消息，节省约 ${result.savedTokens} tokens`,
    );

    return {
      wasCompacted: true,
      messages: compactedMessages,
      savedTokens: microSavedTokens + autoSavedTokens,
      microSavedTokens,
      autoSavedTokens,
      summary: result.summary,
    };
  } catch (error: any) {
    // 断路器记录
    if (tracking) {
      tracking.consecutiveFailures++;
    }
    logger.error(`Auto-compact 失败: ${error.message}`);

    // 返回 micro-compact 的结果（至少不丢失轻量级清理的收益）
    return {
      wasCompacted: microResult.didCompact,
      messages,
      savedTokens: microSavedTokens,
      microSavedTokens,
      autoSavedTokens: 0,
    };
  }
}
