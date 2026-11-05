import type { Locale } from '@zhin.js/plugin-runtime';
import { managementMessages as t } from '../init/management-messages.js';
import { projectPromptContext, AUTOCOMPACT_BUFFER_TOKENS, autoCompactAgentMessagesIfNeeded, createAgentCompactionState, estimateAgentMessagesTokens, type AgentCompactionConfig, type AgentCompactionState, type AgentCompactionExecution, type ContextRepository, type Model, type AgentMessage, type LlmCompletionPort } from '@zhin.js/ai';
import type { CompactionConfig } from '../config/zhin-agent-config.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import { resolveWorkspacePrompt } from '../prompt/workspace-prompt.js';

export interface CompactionContextHost {
  readonly contextRepository: ContextRepository;
}

export interface CompactionRuntimeOptions {
  host: CompactionContextHost;
  sessionId: string;
  model: Model;
  transport: LlmCompletionPort;
  /** Fixed operation selection, invoked only once a summary prefix exists. */
  resolveExecution?: () => Promise<Pick<AgentCompactionExecution, 'model' | 'transport'>>;
  compactionConfig?: CompactionConfig;
  contextWindow: number;
  mode?: 'text' | 'multimodal';
  customInstructions?: string;
  /** Tokens the system prompt and tool schemas take from the window. */
  reservedTokens?: number;
  /** Rendered "already told" ledger; the summary must keep these facts. */
  toldLedger?: string;
  force?: boolean;
  /** Isolated child turns compact in memory without writing conversational state. */
  persistSummary?: boolean;
  loopHooks?: PluginAILoopHookRegistry | null;
  /** History window token budget to align compaction thresholds against. */
  historyWindowTokens?: number;
  /** History window message budget to align compaction thresholds against. */
  historyWindowMessages?: number;
  /** Explicit message-count trigger threshold override. */
  triggerMessages?: number;
  /** Explicit recent-messages count to retain during compaction. */
  keepRecentMessages?: number;
}

export interface UnifiedHistoryAndCompactionBudget {
  readonly windowTokens: number;
  readonly windowMessages: number;
  readonly effectiveTriggerTokens: number;
  readonly effectiveKeepRecentTokens: number;
  readonly effectiveTriggerMessages?: number;
  readonly effectiveKeepRecentMessages?: number;
}

export interface AgentCompactionRuntimeOptions {
  readonly maxSessions?: number;
  readonly historyWindowTokens?: number;
  readonly historyWindowMessages?: number;
  readonly triggerTokens?: number;
  readonly keepRecentTokens?: number;
  readonly triggerMessages?: number;
  readonly keepRecentMessages?: number;
}

export function resolveUnifiedHistoryAndCompactionBudget(input: {
  windowTokens?: number;
  windowMessages?: number;
  triggerTokens?: number;
  keepRecentTokens?: number;
  triggerMessages?: number;
  keepRecentMessages?: number;
}): UnifiedHistoryAndCompactionBudget {
  const windowTokens = input.windowTokens && input.windowTokens > 0 ? input.windowTokens : 8000;
  const windowMessages = input.windowMessages && input.windowMessages > 0 ? input.windowMessages : 20;

  const rawTriggerTokens = input.triggerTokens ?? Math.max(1000, Math.floor(windowTokens * 0.85));
  const effectiveTriggerTokens = Math.min(rawTriggerTokens, windowTokens);

  const rawKeepRecentTokens = input.keepRecentTokens ?? Math.max(400, Math.floor(effectiveTriggerTokens * 0.5));
  const effectiveKeepRecentTokens = Math.min(rawKeepRecentTokens, Math.max(1, Math.floor(windowTokens * 0.75)));

  const hasMessageAlignment = input.windowMessages !== undefined
    || input.triggerMessages !== undefined
    || input.keepRecentMessages !== undefined;
  const effectiveTriggerMessages = hasMessageAlignment && input.triggerMessages !== undefined && input.triggerMessages > 0
    ? Math.min(input.triggerMessages, windowMessages)
    : undefined;
  const effectiveKeepRecentMessages = hasMessageAlignment
    ? (input.keepRecentMessages !== undefined && input.keepRecentMessages > 0
      ? Math.min(input.keepRecentMessages, Math.max(1, Math.floor(windowMessages * 0.75)))
      : effectiveTriggerMessages !== undefined
        ? Math.max(1, Math.floor(effectiveTriggerMessages * 0.6))
        : undefined)
    : undefined;

  return Object.freeze({
    windowTokens,
    windowMessages,
    effectiveTriggerTokens,
    effectiveKeepRecentTokens,
    ...(effectiveTriggerMessages !== undefined ? { effectiveTriggerMessages } : {}),
    ...(effectiveKeepRecentMessages !== undefined ? { effectiveKeepRecentMessages } : {}),
  });
}

/** Default share of the context window that triggers auto-compaction (#730). */
export const DEFAULT_COMPACTION_THRESHOLD_RATIO = 0.7;

/**
 * Message-token count above which auto-compaction runs: `thresholdRatio` of
 * the window minus what the system prompt and tools already use. It never
 * exceeds the older "window minus buffer" rule (when that is positive).
 * Fixed request tokens are deducted from both limits; retention cannot raise
 * the trigger beyond the available window.
 */
export function resolveCompactionTriggerTokens(
  compaction: CompactionConfig | undefined,
  contextWindow: number,
  reservedTokens = 0,
): number {
  const ratio = compaction?.thresholdRatio ?? DEFAULT_COMPACTION_THRESHOLD_RATIO;
  const target = Math.floor(contextWindow * ratio);
  const ceiling = contextWindow - AUTOCOMPACT_BUFFER_TOKENS;
  const bounded = ceiling > 0 ? Math.min(target, ceiling) : target;
  return Math.max(0, bounded - Math.max(0, reservedTokens));
}

function resolveAgentCompactionConfig(
  compaction: CompactionConfig | undefined,
  contextWindow: number,
  reservedTokens?: number,
  alignment?: {
    historyWindowTokens?: number;
    historyWindowMessages?: number;
    triggerMessages?: number;
    keepRecentMessages?: number;
  },
): AgentCompactionConfig {
  let triggerTokens = resolveCompactionTriggerTokens(compaction, contextWindow, reservedTokens);
  // 沿用触发预算与保留预算的 1.25 倍余量；小窗口收紧保留量，不抬高触发线。
  let keepRecentTokens = Math.min(compaction?.keepRecentTokens ?? 20_000, Math.floor(triggerTokens / 1.25));
  let triggerMessages = alignment?.triggerMessages ?? (compaction as { triggerMessages?: number } | undefined)?.triggerMessages;
  let keepRecentMessages = alignment?.keepRecentMessages ?? (compaction as { keepRecentMessages?: number } | undefined)?.keepRecentMessages;

  if (
    alignment?.historyWindowTokens !== undefined
    || alignment?.historyWindowMessages !== undefined
    || triggerMessages !== undefined
    || keepRecentMessages !== undefined
  ) {
    const unified = resolveUnifiedHistoryAndCompactionBudget({
      windowTokens: alignment?.historyWindowTokens ?? contextWindow,
      windowMessages: alignment?.historyWindowMessages,
      triggerTokens,
      keepRecentTokens,
      triggerMessages,
      keepRecentMessages,
    });
    if (alignment?.historyWindowTokens !== undefined) {
      triggerTokens = Math.min(triggerTokens, unified.effectiveTriggerTokens);
      keepRecentTokens = Math.min(keepRecentTokens, unified.effectiveKeepRecentTokens);
    }
    triggerMessages = unified.effectiveTriggerMessages ?? triggerMessages;
    keepRecentMessages = unified.effectiveKeepRecentMessages ?? keepRecentMessages;
  }

  return {
    enabled: compaction?.enabled !== false,
    auto: compaction?.auto !== false,
    keepRecentTokens,
    ...(keepRecentMessages !== undefined ? { keepRecentMessages } : {}),
    minKeepCount: compaction?.minKeepCount ?? 2,
    contextWindow,
    triggerTokens,
    ...(triggerMessages !== undefined ? { triggerMessages } : {}),
  };
}

const TOLD_LEDGER_SUMMARY_INSTRUCTION = 'The user has already been told the following. Keep every item in the summary '
  + '(under "Already told the user") so later turns neither repeat nor contradict them:';

const MAX_COMPACTION_SESSIONS = 5000;

/** One Agent host's compaction state and operations. */
export class AgentCompactionRuntime {
  readonly #states = new Map<string, AgentCompactionState>();
  private readonly maxSessions: number;
  #alignment?: AgentCompactionRuntimeOptions;

  constructor(maxSessionsOrOptions: number | AgentCompactionRuntimeOptions = MAX_COMPACTION_SESSIONS) {
    const maxSessions = typeof maxSessionsOrOptions === 'number'
      ? maxSessionsOrOptions
      : (maxSessionsOrOptions.maxSessions ?? MAX_COMPACTION_SESSIONS);
    if (!Number.isInteger(maxSessions) || maxSessions < 1) {
      throw new TypeError('AgentCompactionRuntime maxSessions must be a positive integer');
    }
    this.maxSessions = maxSessions;
    if (typeof maxSessionsOrOptions === 'object' && maxSessionsOrOptions !== null) {
      this.#alignment = maxSessionsOrOptions;
    }
  }

  alignWithHistoryWindow(window: {
    maxTokens?: number;
    budget?: number;
    maxMessages?: number;
    triggerTokens?: number;
    keepRecentTokens?: number;
    triggerMessages?: number;
    keepRecentMessages?: number;
  }): UnifiedHistoryAndCompactionBudget {
    const windowTokens = window.maxTokens ?? window.budget ?? this.#alignment?.historyWindowTokens;
    const windowMessages = window.maxMessages ?? this.#alignment?.historyWindowMessages;
    const unified = resolveUnifiedHistoryAndCompactionBudget({
      windowTokens,
      windowMessages,
      triggerTokens: window.triggerTokens ?? this.#alignment?.triggerTokens,
      keepRecentTokens: window.keepRecentTokens ?? this.#alignment?.keepRecentTokens,
      triggerMessages: window.triggerMessages ?? this.#alignment?.triggerMessages,
      keepRecentMessages: window.keepRecentMessages ?? this.#alignment?.keepRecentMessages,
    });
    this.#alignment = {
      ...this.#alignment,
      historyWindowTokens: unified.windowTokens,
      historyWindowMessages: unified.windowMessages,
      triggerTokens: unified.effectiveTriggerTokens,
      keepRecentTokens: unified.effectiveKeepRecentTokens,
      triggerMessages: unified.effectiveTriggerMessages,
      keepRecentMessages: unified.effectiveKeepRecentMessages,
    };
    return unified;
  }

  get stateCount(): number {
    return this.#states.size;
  }

  clear(): void {
    this.#states.clear();
  }

  touch(sessionId: string): void {
    const state = this.#states.get(sessionId);
    if (!state) return;
    this.#states.delete(sessionId);
    this.#states.set(sessionId, state);
  }

  evictIfOverPressure(): number {
    if (this.#states.size <= this.maxSessions * 0.8) return 0;
    const targetSize = Math.floor(this.maxSessions * 0.6);
    let removed = 0;
    for (const sessionId of this.#states.keys()) {
      if (this.#states.size <= targetSize) break;
      this.#states.delete(sessionId);
      removed += 1;
    }
    return removed;
  }

  async transformContext(
    messages: AgentMessage[],
    signal: AbortSignal | undefined,
    options: CompactionRuntimeOptions,
  ): Promise<AgentMessage[]> {
    if (signal?.aborted) return messages;

    const cfg = resolveAgentCompactionConfig(
      options.compactionConfig,
      options.contextWindow,
      options.reservedTokens,
      {
        historyWindowTokens: options.historyWindowTokens ?? this.#alignment?.historyWindowTokens,
        historyWindowMessages: options.historyWindowMessages ?? this.#alignment?.historyWindowMessages,
        triggerMessages: options.triggerMessages ?? this.#alignment?.triggerMessages,
        keepRecentMessages: options.keepRecentMessages ?? this.#alignment?.keepRecentMessages,
      },
    );
    if (cfg.enabled === false) return messages;

    const state = this.#getState(options.sessionId);
    const result = await autoCompactAgentMessagesIfNeeded({
      transport: options.transport,
      model: options.model,
      messages,
      config: cfg,
      state,
      force: options.force,
      resolveExecution: async () => {
        const execution = options.resolveExecution ? await options.resolveExecution() : options;
        const compactionPrompt = resolveWorkspacePrompt('compaction', execution.model.promptFamily);
        const customInstructions = [
          compactionPrompt?.trim(), options.customInstructions?.trim(),
          options.toldLedger?.trim() ? `${TOLD_LEDGER_SUMMARY_INSTRUCTION}\n${options.toldLedger.trim()}` : undefined,
        ].filter(Boolean).join('\n\n') || undefined;
        return { model: execution.model, transport: execution.transport, customInstructions };
      },
      signal,
    });

    if (signal?.aborted) return messages;
    if (options.persistSummary !== false && result.summary?.trim() && result.compactedCount) {
      // Use the actual summarized prefix before micro-compaction replaces objects.
      // Current-turn messages are persisted later; never infer their row boundary
      // by independently applying the retention budget to stored history.
      await options.host.contextRepository.saveCompactionSummary?.(
        options.sessionId,
        result.summary,
        messages.slice(0, result.compactedCount),
        signal,
      );
    }
    if (signal?.aborted) return messages;

    let out = result.messages;
    if (options.loopHooks) {
      out = await options.loopHooks.runTransformContext(out, {
        sessionId: options.sessionId,
        signal,
      });
    }
    return out;
  }

  async compactSession(
    repo: ContextRepository,
    options: Omit<CompactionRuntimeOptions, 'host'> & { host: CompactionContextHost; locale?: Locale },
  ): Promise<{ ok: boolean; message: string }> {
    const cfg = resolveAgentCompactionConfig(
      options.compactionConfig,
      options.contextWindow,
      options.reservedTokens,
      {
        historyWindowTokens: options.historyWindowTokens ?? this.#alignment?.historyWindowTokens,
        historyWindowMessages: options.historyWindowMessages ?? this.#alignment?.historyWindowMessages,
        triggerMessages: options.triggerMessages ?? this.#alignment?.triggerMessages,
        keepRecentMessages: options.keepRecentMessages ?? this.#alignment?.keepRecentMessages,
      },
    );
    if (cfg.enabled === false) {
      return { ok: false, message: t(options.locale, 'compactDisabled') };
    }

    const loaded = await repo.loadContext(options.sessionId);
    const messages = loaded.messages;
    if (messages.length < 2) {
      return { ok: false, message: t(options.locale, 'compactShort') };
    }

    const compacted = await this.transformContext(messages, undefined, {
      ...options,
      force: true,
    });

    const saved = estimateAgentMessagesTokens(projectPromptContext(messages)) - estimateAgentMessagesTokens(projectPromptContext(compacted));
    return {
      ok: true,
      message: t(options.locale, 'compacted', { saved: Math.max(0, saved), recent: cfg.keepRecentTokens ?? 20_000 }),
    };
  }

  #getState(sessionId: string): AgentCompactionState {
    const existing = this.#states.get(sessionId);
    if (existing) {
      this.touch(sessionId);
      return existing;
    }
    const state = createAgentCompactionState();
    this.#states.set(sessionId, state);
    return state;
  }
}
