/**
 * AgentMessage compaction — ADR 0010 D1 (pi coding-agent aligned).
 */

import { formatCompact, truncatePreview, getLogger } from '@zhin.js/logger';
import {
  createUserMessage,
  type AgentMessage,
  type AssistantMessage,
  type ToolResultMessage,
  type UserMessage,
} from '../llm/types/agent-message.js';

import { projectPromptContext } from '../memory/prompt-context.js';
import type { Model } from '../llm/types/model.js';
import { createContext } from '../llm/index.js';
import type { LlmCompletionPort } from '../llm/llm-api-runtime.js';
import {
  AUTOCOMPACT_BUFFER_TOKENS,
  DEFAULT_CONTEXT_TOKENS,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
} from './compaction.js';
import {
  estimateAgentMessageTokens,
  estimateAgentMessagesTokens,
  findKeepRecentStartIndex,
} from './agent-message-tokens.js';
import { microCompactAgentMessages } from './agent-micro-compact.js';
import { userMessageBody } from '../memory/user-message-presentation.js';

const logger = getLogger('AgentCompaction');

const DEFAULT_SUMMARY_FALLBACK = '无历史记录。';
const SUMMARY_USER_PREFIX = '[Previous conversation summary]\n';

const SUMMARY_SYSTEM = `You are a conversation summarization assistant. Compress the following conversation into a concise summary. Keep:
- Key decisions and conclusions
- Unfinished action items and open questions
- Important user preferences and constraints
- Which participant made each request, decision, constraint, or action item
- Conflicting opinions and whether they remain unresolved
- The source of authority-sensitive decisions
- Core topics discussed

The summary should be brief but informative so that later turns can quickly recover context.`;

export interface AgentCompactionConfig {
  enabled?: boolean;
  auto?: boolean;
  keepRecentTokens?: number;
  minKeepCount?: number;
  contextWindow?: number;
  /**
   * Message tokens above which auto-compaction runs. Defaults to
   * `contextWindow - AUTOCOMPACT_BUFFER_TOKENS`.
   */
  triggerTokens?: number;
}

export interface AgentCompactionState {
  consecutiveFailures: number;
}

export interface AgentCompactResult {
  wasCompacted: boolean;
  messages: AgentMessage[];
  savedTokens: number;
  microSavedTokens: number;
  autoSavedTokens: number;
  summary?: string;
  /** Prefix length in the input array (micro-compaction preserves positions). */
  compactedCount?: number;
}

export function createAgentCompactionState(): AgentCompactionState {
  return { consecutiveFailures: 0 };
}

/** Shared with the resilience layer; see `llm/context-overflow.ts`. */
export { isContextOverflowError } from '../llm/context-overflow.js';

function textBlocks(message: AgentMessage): string {
  if (!('content' in message) || !Array.isArray(message.content)) return '';
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function agentMessageToTranscriptLine(message: AgentMessage): string {
  if (message.role === 'user') {
    const user = message as UserMessage;
    const text = userMessageBody(user);
    const actor = user.actor;
    if (!actor) return `[User] ${text}`;
    const name = actor.displayName?.trim() || actor.subjectId;
    const roles = actor.roles?.length ? actor.roles.join(',') : 'user';
    return `[User:${name} id=${actor.subjectId} roles=${roles}] ${text}`;
  }
  if (message.role === 'assistant') {
    const assistant = message as AssistantMessage;
    const content = assistant.content.flatMap((block) => {
      if (block.type === 'text') return [block.text];
      if (block.type === 'toolCall') {
        return [`[Tool call] ${JSON.stringify({
          id: block.id,
          name: block.name,
          arguments: block.arguments,
          ...(block.inputError ? { inputError: block.inputError } : {}),
        })}`];
      }
      return [];
    }).join('\n');
    return `[Assistant] ${content}`;
  }
  if (message.role === 'toolResult') {
    const result = message as ToolResultMessage;
    const outcome = JSON.stringify({ toolCallId: result.toolCallId, toolName: result.toolName, isError: result.isError });
    return `[Tool:${result.toolName}] ${outcome}\n${textBlocks(message)}`;
  }
  return `[${message.role}] ${JSON.stringify(message)}`;
}

async function summarizeAgentMessages(
  transport: LlmCompletionPort,
  model: Model,
  messages: AgentMessage[],
  previousSummary?: string,
  customInstructions?: string,
  signal?: AbortSignal,
): Promise<string> {
  if (messages.length === 0) {
    return previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  let systemPrompt = SUMMARY_SYSTEM;
  if (customInstructions) {
    systemPrompt += `\n\nAdditional instructions: ${customInstructions}`;
  }

  const conversation = projectPromptContext(messages).map(agentMessageToTranscriptLine).join('\n');
  let userContent = '';
  if (previousSummary) {
    userContent += `Previous summary:\n${previousSummary}\n\n`;
  }
  userContent += `New conversation:\n${conversation}\n\nGenerate the updated full summary.`;

  try {
    signal?.throwIfAborted();
    const assistant = await transport.completeSimple(
      model,
      createContext(systemPrompt, [createUserMessage(userContent)]),
      signal ? { signal } : undefined,
    );
    signal?.throwIfAborted();
    // 只接纳完整文本摘要，不能把截断片段或请求工具的响应写成历史事实。
    if (assistant.stopReason !== 'stop' || assistant.content.some(block => block.type === 'toolCall')) {
      throw new Error(`Summarization did not complete: ${assistant.stopReason}`);
    }
    const text = assistant.content
      .filter(b => b.type === 'text')
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();
    // 空摘要视为失败：不能把占位文本当真摘要注入（会静默丢历史）
    if (!text) {
      throw new Error('Summarization returned empty content');
    }
    return text;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(formatCompact({ summarize: 'fail', error: truncatePreview(message) }));
    // 摘要失败必须抛错：由上层 catch 保留原文并计入熔断（fallback 仅限消息为空）
    throw e;
  }
}

export function summaryAsAgentUserMessage(summary: string, createdAt = Date.now()): AgentMessage {
  return createUserMessage(`${SUMMARY_USER_PREFIX}${summary}`, undefined, createdAt);
}

export function shouldAutoCompactAgentMessages(
  messages: AgentMessage[],
  contextWindow: number,
  state?: AgentCompactionState,
  triggerTokens?: number,
): boolean {
  if (state && state.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    logger.warn(formatCompact({ circuit_breaker: state.consecutiveFailures }));
    return false;
  }
  const totalTokens = estimateAgentMessagesTokens(projectPromptContext(messages));
  return totalTokens > (triggerTokens ?? contextWindow - AUTOCOMPACT_BUFFER_TOKENS);
}

export async function compactAgentMessages(params: {
  transport: LlmCompletionPort;
  model: Model;
  messages: AgentMessage[];
  contextWindow?: number;
  keepRecentTokens?: number;
  minKeepCount?: number;
  customInstructions?: string;
  signal?: AbortSignal;
}): Promise<{
  summary: string;
  keptMessages: AgentMessage[];
  compactedCount: number;
  savedTokens: number;
}> {
  const contextWindow = params.contextWindow ?? DEFAULT_CONTEXT_TOKENS;
  const keepRecentTokens = params.keepRecentTokens ?? 20_000;
  const minKeepCount = params.minKeepCount ?? 2;
  const messages = params.messages;

  const startIdx = findKeepRecentStartIndex(messages, keepRecentTokens, minKeepCount);
  if (startIdx === 0) {
    return { summary: '', keptMessages: messages, compactedCount: 0, savedTokens: 0 };
  }

  const toCompact = messages.slice(0, startIdx);
  const toKeep = messages.slice(startIdx);
  const beforeTokens = estimateAgentMessagesTokens(projectPromptContext(toCompact));

  const summary = await summarizeAgentMessages(
    params.transport,
    params.model,
    toCompact,
    undefined,
    params.customInstructions,
    params.signal,
  );

  const summaryTokens = estimateAgentMessageTokens(summaryAsAgentUserMessage(summary));
  if (summaryTokens >= beforeTokens) {
    throw new Error('Summarization did not reduce context tokens');
  }
  return {
    summary,
    keptMessages: toKeep,
    compactedCount: toCompact.length,
    savedTokens: Math.max(0, estimateAgentMessagesTokens(projectPromptContext(messages))
      - estimateAgentMessagesTokens(projectPromptContext([summaryAsAgentUserMessage(summary), ...toKeep]))),
  };
}

export async function autoCompactAgentMessagesIfNeeded(params: {
  transport: LlmCompletionPort;
  model: Model;
  messages: AgentMessage[];
  config?: AgentCompactionConfig;
  state?: AgentCompactionState;
  force?: boolean;
  customInstructions?: string;
  /** 取消信号：透传给摘要请求；取消不计入熔断失败数。 */
  signal?: AbortSignal;
}): Promise<AgentCompactResult> {
  const config = params.config ?? {};
  if (config.enabled === false) {
    return {
      wasCompacted: false,
      messages: params.messages,
      savedTokens: 0,
      microSavedTokens: 0,
      autoSavedTokens: 0,
    };
  }

  const contextWindow = config.contextWindow ?? DEFAULT_CONTEXT_TOKENS;
  const state = params.state;
  let messages = params.messages;
  let microSavedTokens = 0;

  const micro = microCompactAgentMessages(messages, {
    tokenThreshold: Math.floor(contextWindow * 0.6),
  });
  if (micro.didCompact) {
    messages = micro.messages;
    microSavedTokens = micro.savedTokens;
  }

  const autoEnabled = config.auto !== false;
  const needsAuto = params.force || (autoEnabled && shouldAutoCompactAgentMessages(messages, contextWindow, state, config.triggerTokens));
  if (!needsAuto) {
    return {
      wasCompacted: micro.didCompact,
      messages,
      savedTokens: microSavedTokens,
      microSavedTokens,
      autoSavedTokens: 0,
    };
  }

  try {
    const result = await compactAgentMessages({
      transport: params.transport,
      model: params.model,
      messages,
      contextWindow,
      keepRecentTokens: config.keepRecentTokens,
      minKeepCount: config.minKeepCount,
      customInstructions: params.customInstructions,
      signal: params.signal,
    });

    // 最少保留数或工具配对可能使本次无可压缩前缀；不能宣称摘要成功。
    if (result.compactedCount === 0) {
      return {
        wasCompacted: micro.didCompact, messages, savedTokens: microSavedTokens,
        microSavedTokens, autoSavedTokens: 0,
      };
    }

    const compactedMessages: AgentMessage[] = [];
    if (result.summary) {
      compactedMessages.push(summaryAsAgentUserMessage(result.summary));
    }
    compactedMessages.push(...result.keptMessages);
    // Removing the first full context block can expand retained references.
    // Validate the entire resulting model view before committing a checkpoint.
    if (estimateAgentMessagesTokens(projectPromptContext(compactedMessages))
      >= estimateAgentMessagesTokens(projectPromptContext(messages))) {
      throw new Error('Summarization did not reduce projected context tokens');
    }

    if (state) state.consecutiveFailures = 0;

    return {
      wasCompacted: true,
      messages: compactedMessages,
      savedTokens: Math.max(0, estimateAgentMessagesTokens(projectPromptContext(params.messages))
        - estimateAgentMessagesTokens(projectPromptContext(compactedMessages))),
      microSavedTokens,
      autoSavedTokens: result.savedTokens,
      summary: result.summary,
      compactedCount: result.compactedCount,
    };
  } catch (error: unknown) {
    if (state && !params.signal?.aborted) state.consecutiveFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Auto-compact failed: ${message}`);
    return {
      wasCompacted: micro.didCompact,
      messages,
      savedTokens: microSavedTokens,
      microSavedTokens,
      autoSavedTokens: 0,
    };
  }
}
