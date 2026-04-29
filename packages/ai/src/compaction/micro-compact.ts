/**
 * Micro-Compact — 工具结果微压缩
 *
 * 参考 Claude Code 的 microCompact.ts 设计：
 * 在主压缩（auto-compact）之前执行轻量级清理，
 * 对旧的工具调用结果替换为占位符，保留 user/assistant 文本块。
 *
 * 策略：
 *   1. 基于时间衰减：越早的 tool_result 越先被清理
 *   2. 仅清理可压缩类型的工具结果（file_read, bash, grep 等）
 *   3. 保留 user/assistant/system 消息不动
 *   4. 保留最近 N 条工具结果不清理
 */

import type { ChatMessage } from '../types.js';
import { estimateTokens } from './token-counter.js';

// ============================================================================
// 常量
// ============================================================================

/** 可压缩的工具类型集合（大型输出工具） */
export const COMPACTABLE_TOOLS = new Set([
  'file_read', 'read_file',
  'bash', 'shell', 'exec',
  'grep', 'grep_search', 'search',
  'web_fetch', 'web_search', 'fetch',
  'list_dir', 'list_directory',
  'read_notebook', 'run_notebook',
]);

/** 被清理后的占位文本 */
export const CLEARED_MESSAGE = '[旧工具结果已清理]';

/** 图片/文档消息的预估 token 数 */
export const IMAGE_MAX_TOKEN_SIZE = 2_000;

/** 默认保留最近 N 条工具结果不清理 */
export const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 6;

/** micro-compact 默认 token 节省目标（不清理超过所需的量） */
export const DEFAULT_TARGET_SAVINGS_RATIO = 0.3;

// ============================================================================
// 工具名提取
// ============================================================================

/**
 * 从 tool_result 消息中推断关联的工具名
 *
 * 通过在消息历史中查找匹配 tool_call_id 的 tool_call 来确定。
 */
function findToolNameForResult(
  messages: ChatMessage[],
  resultMsg: ChatMessage,
  resultIndex: number,
): string | undefined {
  if (!resultMsg.tool_call_id) return undefined;

  // 向前查找最近的包含 tool_calls 的 assistant 消息
  for (let i = resultIndex - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tool_calls) {
      const match = msg.tool_calls.find(tc => tc.id === resultMsg.tool_call_id);
      if (match) return match.function.name;
    }
  }
  return undefined;
}

// ============================================================================
// Micro-Compact
// ============================================================================

export interface MicroCompactOptions {
  /** 保留最近 N 条工具结果不清理 */
  keepRecentToolResults?: number;
  /** 仅当总 token 超过此阈值时才执行微压缩 */
  tokenThreshold?: number;
  /** 可压缩的工具名集合（默认使用 COMPACTABLE_TOOLS） */
  compactableTools?: Set<string>;
}

export interface MicroCompactResult {
  /** 压缩后的消息列表 */
  messages: ChatMessage[];
  /** 清理的工具结果数量 */
  clearedCount: number;
  /** 节省的估计 token 数 */
  savedTokens: number;
  /** 是否执行了清理 */
  didCompact: boolean;
}

/**
 * 对消息列表执行微压缩
 *
 * 从最旧的 tool/tool_result 消息开始，将可压缩工具的结果替换为占位符。
 * user/assistant/system 消息保持不变。
 */
export function microCompactMessages(
  messages: ChatMessage[],
  options: MicroCompactOptions = {},
): MicroCompactResult {
  const keepRecent = options.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS;
  const compactableTools = options.compactableTools ?? COMPACTABLE_TOOLS;

  // 不够消息就不压缩
  if (messages.length <= keepRecent) {
    return { messages, clearedCount: 0, savedTokens: 0, didCompact: false };
  }

  // 如果设置了 token 阈值，先检查是否需要压缩
  if (options.tokenThreshold) {
    const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
    if (totalTokens <= options.tokenThreshold) {
      return { messages, clearedCount: 0, savedTokens: 0, didCompact: false };
    }
  }

  // 找出所有 tool/tool_result 消息的索引
  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'tool' || msg.role === 'tool_result') {
      toolResultIndices.push(i);
    }
  }

  // 保留最近的 N 个工具结果
  const candidateIndices = toolResultIndices.slice(
    0,
    Math.max(0, toolResultIndices.length - keepRecent),
  );

  if (candidateIndices.length === 0) {
    return { messages, clearedCount: 0, savedTokens: 0, didCompact: false };
  }

  // 执行清理
  const result = [...messages];
  let clearedCount = 0;
  let savedTokens = 0;

  for (const idx of candidateIndices) {
    const msg = result[idx];
    const toolName = findToolNameForResult(messages, msg, idx);

    // 仅清理可压缩工具的结果
    const isCompactable = !toolName || compactableTools.has(toolName);
    if (!isCompactable) continue;

    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    // 只清理内容较大的结果（>100 字符）
    if (content.length <= 100) continue;

    const originalTokens = estimateTokens(msg);
    const clearedTokens = estimateTokens({ ...msg, content: CLEARED_MESSAGE });

    result[idx] = {
      ...msg,
      content: CLEARED_MESSAGE,
    };

    clearedCount++;
    savedTokens += originalTokens - clearedTokens;
  }

  return {
    messages: result,
    clearedCount,
    savedTokens,
    didCompact: clearedCount > 0,
  };
}
