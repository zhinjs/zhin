/**
 * Session tree runtime — 供 Host API 调用（ADR 0010 D3 Console API）。
 * Generation-scoped：provide 随 lifecycle 反注册，杜绝跨热重载悬挂。
 */

import {
  createGenerationStore,
  type Dispose,
  type GenerationStoreContext,
} from '@zhin.js/plugin-runtime';
import type {
  AgentSessionStore,
  ContextRepository,
  MemoryAgentSessionStore,
  SessionBranchPoint,
} from '@zhin.js/ai';
import {
  jumpToBranchIndexWithSummarization,
  switchActiveLeafWithBranchSummarization,
} from './session/branch-summarization-runtime.js';
import type { ZhinAgentPrivate } from './internal/agent-host.js';

export interface SessionTreeRuntimeHandle {
  contextRepository: ContextRepository;
  agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  switchActiveLeaf(sessionId: string, messageId: number): Promise<boolean>;
  jumpToBranchIndex(sessionId: string, index: number): Promise<{ ok: boolean; message: string }>;
  listBranchPoints(sessionId: string): Promise<SessionBranchPoint[]>;
  resolveActiveSessionId(sessionKey: string): Promise<string | null>;
}

const store = createGenerationStore<SessionTreeRuntimeHandle>('zhin.agent.session-tree-runtime');

export function provideSessionTreeRuntime(
  context: GenerationStoreContext,
  handle: SessionTreeRuntimeHandle,
): Dispose {
  return store.provide(context, handle);
}

export function getSessionTreeRuntime(): SessionTreeRuntimeHandle | null {
  return store.tryUse() ?? null;
}

export function createSessionTreeRuntimeFromAgent(
  host: ZhinAgentPrivate,
): SessionTreeRuntimeHandle {
  return {
    contextRepository: host.contextRepository,
    agentSessionStore: host.agentSessionStore,
    switchActiveLeaf: (sessionId, messageId) =>
      switchActiveLeafWithBranchSummarization(host, sessionId, messageId),
    jumpToBranchIndex: (sessionId, index) =>
      jumpToBranchIndexWithSummarization(host, sessionId, index),
    listBranchPoints: (sessionId) => host.contextRepository.listBranchPoints(sessionId),
    resolveActiveSessionId: async (sessionKey) => {
      const active = await host.agentSessionStore.findActive(sessionKey);
      return active?.session_id ?? null;
    },
  };
}
