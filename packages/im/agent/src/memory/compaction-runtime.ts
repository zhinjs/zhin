import { autoCompactAgentMessagesIfNeeded, createAgentCompactionState, estimateAgentMessagesTokens, type AgentCompactionConfig, type AgentCompactionState, type ContextRepository, type Model, type AgentMessage, type LlmCompletionPort } from '@zhin.js/ai';
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
  force?: boolean;
  loopHooks?: PluginAILoopHookRegistry | null;
}

function resolveAgentCompactionConfig(
  compaction: CompactionConfig | undefined,
  contextWindow: number,
): AgentCompactionConfig {
  return {
    enabled: compaction?.enabled !== false,
    auto: compaction?.auto !== false,
    keepRecentTokens: compaction?.keepRecentTokens ?? 20_000,
    minKeepCount: compaction?.minKeepCount ?? 2,
    contextWindow,
  };
}

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

    const cfg = resolveAgentCompactionConfig(options.compactionConfig, options.contextWindow);
    if (cfg.enabled === false) return messages;

    const state = this.#getState(options.sessionId);
    const compactionPrompt = resolveWorkspacePrompt('compaction', options.model.sdk);
    const customInstructions = [
      compactionPrompt?.trim(),
      options.customInstructions?.trim(),
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
