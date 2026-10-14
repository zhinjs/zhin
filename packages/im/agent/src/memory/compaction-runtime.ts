import { AUTOCOMPACT_BUFFER_TOKENS, autoCompactAgentMessagesIfNeeded, createAgentCompactionState, estimateAgentMessagesTokens, type AgentCompactionConfig, type AgentCompactionState, type ContextRepository, type Model, type AgentMessage, type LlmCompletionPort } from '@zhin.js/ai';
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
 * exceeds the older "window minus buffer" rule (when that is positive) and
 * never drops below 1.25 × keepRecentTokens, so a compaction frees room.
 */
export function resolveCompactionTriggerTokens(
  compaction: CompactionConfig | undefined,
  contextWindow: number,
  reservedTokens = 0,
): number {
  const ratio = compaction?.thresholdRatio ?? DEFAULT_COMPACTION_THRESHOLD_RATIO;
  const keepRecent = compaction?.keepRecentTokens ?? 20_000;
  const target = Math.floor(contextWindow * ratio) - Math.max(0, reservedTokens);
  const floor = Math.ceil(keepRecent * 1.25);
  const ceiling = contextWindow - AUTOCOMPACT_BUFFER_TOKENS;
  const bounded = ceiling > 0 ? Math.min(target, ceiling) : target;
  return Math.max(bounded, floor);
}

function resolveAgentCompactionConfig(
  compaction: CompactionConfig | undefined,
  contextWindow: number,
  reservedTokens?: number,
): AgentCompactionConfig {
  return {
    enabled: compaction?.enabled !== false,
    auto: compaction?.auto !== false,
    keepRecentTokens: compaction?.keepRecentTokens ?? 20_000,
    minKeepCount: compaction?.minKeepCount ?? 2,
    contextWindow,
    triggerTokens: resolveCompactionTriggerTokens(compaction, contextWindow, reservedTokens),
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
    });

    if (result.summary?.trim()) {
      const anchorId = await options.host.contextRepository.resolveCompactionAnchorId(
        options.sessionId,
        cfg.keepRecentTokens ?? 20_000,
        cfg.minKeepCount ?? 2,
      );
      await options.host.contextRepository.saveSummary(
        options.sessionId,
        result.summary,
        anchorId,
      );
    }

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
    options: Omit<CompactionRuntimeOptions, 'host'> & { host: CompactionContextHost },
  ): Promise<{ ok: boolean; message: string }> {
    const cfg = resolveAgentCompactionConfig(options.compactionConfig, options.contextWindow);
    if (cfg.enabled === false) {
      return { ok: false, message: 'compaction 已禁用（ai.agent.compaction.enabled=false）' };
    }

    const loaded = await repo.loadContext(options.sessionId);
    const messages = loaded.messages;
    if (messages.length < 2) {
      return { ok: false, message: '消息过少，无需压缩' };
    }

    const compacted = await this.transformContext(messages, undefined, {
      ...options,
      force: true,
    });

    const saved = estimateAgentMessagesTokens(messages) - estimateAgentMessagesTokens(compacted);
    return {
      ok: true,
      message: `已压缩会话，约节省 ${Math.max(0, saved)} tokens（保留最近 ~${cfg.keepRecentTokens ?? 20_000} tokens）`,
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
