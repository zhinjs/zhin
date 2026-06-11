import {
  autoCompactAgentMessagesIfNeeded,
  createAgentCompactionState,
  estimateAgentMessagesTokens,
  type AgentCompactionConfig,
  type AgentCompactionState,
  type ContextRepository,
  type Model,
} from '@zhin.js/ai';
import type { AgentMessage } from '@zhin.js/ai';
import type { CompactionConfig } from './config.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import type { ZhinAgentPrivate, ToolContext } from './zhin-agent-private.js';

export interface CompactionRuntimeOptions {
  host: ZhinAgentPrivate;
  sessionId: string;
  context: ToolContext;
  model: Model;
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

const compactionStateBySession = new Map<string, AgentCompactionState>();
const MAX_COMPACTION_SESSIONS = 5000;

function getCompactionState(sessionId: string): AgentCompactionState {
  let state = compactionStateBySession.get(sessionId);
  if (!state) {
    state = createAgentCompactionState();
    compactionStateBySession.set(sessionId, state);
  }
  return state;
}

export function getCompactionStateCount(): number {
  return compactionStateBySession.size;
}

export function evictCompactionStatesIfOverPressure(): number {
  let removed = 0;
  if (compactionStateBySession.size > MAX_COMPACTION_SESSIONS * 0.8) {
    const keys = [...compactionStateBySession.keys()];
    const excess = compactionStateBySession.size - Math.floor(MAX_COMPACTION_SESSIONS * 0.6);
    for (let i = 0; i < excess && i < keys.length; i++) {
      compactionStateBySession.delete(keys[i]);
      removed++;
    }
  }
  return removed;
}

export function clearCompactionStates(): void {
  compactionStateBySession.clear();
}

export function touchCompactionState(sessionId: string): void {
  if (compactionStateBySession.has(sessionId)) {
    getCompactionState(sessionId);
  }
}

export async function transformContextWithCompaction(
  messages: AgentMessage[],
  signal: AbortSignal | undefined,
  options: CompactionRuntimeOptions,
): Promise<AgentMessage[]> {
  if (signal?.aborted) return messages;

  const cfg = resolveAgentCompactionConfig(options.compactionConfig, options.contextWindow);
  if (cfg.enabled === false) return messages;

  const beforeTokens = estimateAgentMessagesTokens(messages);
  const state = getCompactionState(options.sessionId);
  const result = await autoCompactAgentMessagesIfNeeded({
    model: options.model,
    messages,
    config: cfg,
    state,
    force: options.force,
    customInstructions: options.customInstructions,
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

  if (result.wasCompacted) {
    const afterTokens = estimateAgentMessagesTokens(result.messages);
    options.host.emitSessionCompactEvent(options.sessionId, options.context, options.mode ?? 'text', {
      microSavedTokens: result.microSavedTokens,
      autoSavedTokens: result.autoSavedTokens,
      totalTokensBefore: beforeTokens,
      totalTokensAfter: afterTokens,
    });
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

export async function manualCompactSession(
  repo: ContextRepository,
  options: Omit<CompactionRuntimeOptions, 'host'> & {
    host: ZhinAgentPrivate;
  },
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

  const compacted = await transformContextWithCompaction(messages, undefined, {
    ...options,
    force: true,
  });

  const saved = estimateAgentMessagesTokens(messages) - estimateAgentMessagesTokens(compacted);
  return {
    ok: true,
    message: `已压缩会话，约节省 ${Math.max(0, saved)} tokens（保留最近 ~${cfg.keepRecentTokens ?? 20_000} tokens）`,
  };
}
