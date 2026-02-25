/**
 * Session Compaction — 会话压缩
 *
 * 借鉴 OpenClaw 的 compaction 设计，当对话历史超过上下文窗口限制时，
 * 通过 LLM 生成摘要来压缩早期消息，保留最近的消息完整性。
 *
 * 核心理念：
 *   1. Token 估算：用 chars/4 粗略估算 token 数
 *   2. 分块（Chunk）：按 token 预算将消息分成多块
 *   3. 渐进式摘要：对每块分别生成摘要，再合并
 *   4. 安全裕度：估算偏低时留 20% buffer
 *   5. 降级策略：摘要失败时使用更粗糙的摘要
 */

import { Logger } from '@zhin.js/logger';
import type { AIProvider, ChatMessage } from './types.js';

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
// Token 估算
// ============================================================================

/**
 * 估算单条消息的 token 数
 * 使用 chars/4 粗略估算（对中文偏高，对英文偏低，但足够用于分块）
 */
export function estimateTokens(message: ChatMessage): number {
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);
  // 消息角色和格式开销约 4 tokens
  return Math.ceil(content.length / 4) + 4;
}

/**
 * 估算消息列表的总 token 数
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

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
    const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '系统';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `[${role}] ${content}`;
  }).join('\n');

  let systemPrompt = `你是一个对话摘要助手。请将以下对话压缩为简洁的摘要，保留：
- 关键决定和结论
- 未完成的 TODO 和待解决的问题
- 重要的用户偏好和约束
- 讨论的核心主题

摘要应该简洁但信息量大，便于后续对话能快速了解上下文。`;

  if (customInstructions) {
    systemPrompt += `\n\n额外要求：${customInstructions}`;
  }

  let userContent = '';
  if (previousSummary) {
    userContent += `之前的摘要：\n${previousSummary}\n\n`;
  }
  userContent += `新的对话内容：\n${conversation}\n\n请生成更新后的完整摘要。`;

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
