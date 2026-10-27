import type { Locale } from '@zhin.js/plugin-runtime';
import { managementMessages as t } from '../init/management-messages.js';
import { projectPromptContext, AUTOCOMPACT_BUFFER_TOKENS, autoCompactAgentMessagesIfNeeded, createAgentCompactionState, estimateAgentMessagesTokens, type AgentCompactionConfig, type AgentCompactionState, type ContextRepository, type Model, type AgentMessage, type LlmCompletionPort } from '@zhin.js/ai';
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
  compactionConfig?: CompactionConfig;
  contextWindow: number;
  mode?: 'text' | 'multimodal';
  customInstructions?: string;
  /** Tokens the system prompt and tool schemas take from the window. */
  reservedTokens?: number;
  /** Rendered "already told" ledger; the summary must keep these facts. */
  toldLedger?: string;
  force?: boolean;
  loopHooks?: PluginAILoopHookRegistry | null;
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
): AgentCompactionConfig {
  const triggerTokens = resolveCompactionTriggerTokens(compaction, contextWindow, reservedTokens);
  // 沿用触发预算与保留预算的 1.25 倍余量；小窗口收紧保留量，不抬高触发线。
  const keepRecentTokens = Math.min(compaction?.keepRecentTokens ?? 20_000, Math.floor(triggerTokens / 1.25));
  return {
    enabled: compaction?.enabled !== false,
    auto: compaction?.auto !== false,
    keepRecentTokens,
    minKeepCount: compaction?.minKeepCount ?? 2,
    contextWindow,
    triggerTokens,
  };
}

const TOLD_LEDGER_SUMMARY_INSTRUCTION = 'The user has already been told the following. Keep every item in the summary '
  + '(under "Already told the user") so later turns neither repeat nor contradict them:';

const MAX_COMPACTION_SESSIONS = 5000;

/** One Agent host's compaction state and operations. */
export class AgentCompactionRuntime {
  readonly #states = new Map<string, AgentCompactionState>();

  constructor(private readonly maxSessions: number = MAX_COMPACTION_SESSIONS) {
    if (!Number.isInteger(maxSessions) || maxSessions < 1) {
      throw new TypeError('AgentCompactionRuntime maxSessions must be a positive integer');
    }
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

    const cfg = resolveAgentCompactionConfig(options.compactionConfig, options.contextWindow, options.reservedTokens);
    if (cfg.enabled === false) return messages;

    const state = this.#getState(options.sessionId);
    const compactionPrompt = resolveWorkspacePrompt('compaction', options.model.sdk);
    const customInstructions = [
      compactionPrompt?.trim(),
      options.customInstructions?.trim(),
      options.toldLedger?.trim() ? `${TOLD_LEDGER_SUMMARY_INSTRUCTION}\n${options.toldLedger.trim()}` : undefined,
    ].filter(Boolean).join('\n\n') || undefined;

    const result = await autoCompactAgentMessagesIfNeeded({
      transport: options.transport,
      model: options.model,
      messages,
      config: cfg,
      state,
      force: options.force,
      customInstructions,
      signal,
    });

    if (signal?.aborted) return messages;
    if (result.summary?.trim() && result.compactedCount) {
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
    const cfg = resolveAgentCompactionConfig(options.compactionConfig, options.contextWindow, options.reservedTokens);
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
