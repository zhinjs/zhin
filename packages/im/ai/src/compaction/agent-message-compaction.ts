/**
 * AgentMessage compaction — ADR 0010 D1 (pi coding-agent aligned).
 */

import { formatCompact, truncatePreview, getLogger } from '@zhin.js/logger';
import { createUserMessage, type AgentMessage } from '../llm/types/agent-message.js';

import type { Model } from '../llm/types/model.js';
import { completeSimple, createContext } from '../llm/index.js';
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

const logger = getLogger('AgentCompaction');

const DEFAULT_SUMMARY_FALLBACK = '无历史记录。';
const SUMMARY_USER_PREFIX = '[Previous conversation summary]\n';

const SUMMARY_SYSTEM = `You are a conversation summarization assistant. Compress the following conversation into a concise summary. Keep:
- Key decisions and conclusions
- Unfinished TODOs and open questions
- Important user preferences and constraints
- Core topics discussed

The summary should be brief but informative so that later turns can quickly recover context.`;

export interface AgentCompactionConfig {
  enabled?: boolean;
  auto?: boolean;
  keepRecentTokens?: number;
  minKeepCount?: number;
  contextWindow?: number;
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
}

export function createAgentCompactionState(): AgentCompactionState {
  return { consecutiveFailures: 0 };
}

export function isContextOverflowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /context.?length|maximum.?context|too.?many.?tokens|token.?limit|context.?window|exceed.*limit|request too large/i.test(msg);
}

function textBlocks(message: AgentMessage): string {
  if (!('content' in message) || !Array.isArray(message.content)) return '';
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function agentMessageToTranscriptLine(message: AgentMessage): string {
  if (message.role === 'user') {
    return `[User] ${textBlocks(message)}`;
  }
  if (message.role === 'assistant') {
    return `[Assistant] ${textBlocks(message)}`;
  }
  if (message.role === 'toolResult') {
    return `[Tool:${'toolName' in message ? message.toolName : 'tool'}] ${textBlocks(message)}`;
  }
  return `[${message.role}] ${JSON.stringify(message)}`;
}

async function summarizeAgentMessages(
  model: Model,
  messages: AgentMessage[],
  previousSummary?: string,
  customInstructions?: string,
): Promise<string> {
  if (messages.length === 0) {
    return previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  let systemPrompt = SUMMARY_SYSTEM;
  if (customInstructions) {
    systemPrompt += `\n\nAdditional instructions: ${customInstructions}`;
  }

  const conversation = messages.map(agentMessageToTranscriptLine).join('\n');
  let userContent = '';
  if (previousSummary) {
    userContent += `Previous summary:\n${previousSummary}\n\n`;
  }
  userContent += `New conversation:\n${conversation}\n\nGenerate the updated full summary.`;

  try {
    const assistant = await completeSimple(
      model,
      createContext(systemPrompt, [createUserMessage(userContent)]),
    );
    const text = assistant.content
      .filter(b => b.type === 'text')
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();
    return text || DEFAULT_SUMMARY_FALLBACK;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(formatCompact({ summarize: 'fail', error: truncatePreview(message) }));
    return DEFAULT_SUMMARY_FALLBACK;
  }
}

export function summaryAsAgentUserMessage(summary: string, createdAt = Date.now()): AgentMessage {
  return createUserMessage(`${SUMMARY_USER_PREFIX}${summary}`, undefined, createdAt);
}

export function shouldAutoCompactAgentMessages(
  messages: AgentMessage[],
  contextWindow: number,
  state?: AgentCompactionState,
): boolean {
  if (state && state.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    logger.warn(formatCompact({ circuit_breaker: state.consecutiveFailures }));
    return false;
  }
  const totalTokens = estimateAgentMessagesTokens(messages);
  return totalTokens > contextWindow - AUTOCOMPACT_BUFFER_TOKENS;
}

export async function compactAgentMessages(params: {
  model: Model;
  messages: AgentMessage[];
  contextWindow?: number;
  keepRecentTokens?: number;
  minKeepCount?: number;
  customInstructions?: string;
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
  const beforeTokens = estimateAgentMessagesTokens(toCompact);

  const summary = await summarizeAgentMessages(
    params.model,
    toCompact,
    undefined,
    params.customInstructions,
  );

  const summaryTokens = estimateAgentMessageTokens(summaryAsAgentUserMessage(summary));
  return {
    summary,
    keptMessages: toKeep,
    compactedCount: toCompact.length,
    savedTokens: Math.max(0, beforeTokens - summaryTokens),
  };
}

export async function autoCompactAgentMessagesIfNeeded(params: {
  model: Model;
  messages: AgentMessage[];
  config?: AgentCompactionConfig;
  state?: AgentCompactionState;
  force?: boolean;
  customInstructions?: string;
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
  const needsAuto = params.force || (autoEnabled && shouldAutoCompactAgentMessages(messages, contextWindow, state));
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
      model: params.model,
      messages,
      contextWindow,
      keepRecentTokens: config.keepRecentTokens,
      minKeepCount: config.minKeepCount,
      customInstructions: params.customInstructions,
    });

    const compactedMessages: AgentMessage[] = [];
    if (result.summary) {
      compactedMessages.push(summaryAsAgentUserMessage(result.summary));
    }
    compactedMessages.push(...result.keptMessages);

    if (state) state.consecutiveFailures = 0;

    return {
      wasCompacted: true,
      messages: compactedMessages,
      savedTokens: microSavedTokens + result.savedTokens,
      microSavedTokens,
      autoSavedTokens: result.savedTokens,
      summary: result.summary,
    };
  } catch (error: unknown) {
    if (state) state.consecutiveFailures += 1;
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
