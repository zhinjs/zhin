/**
 * Session tree runtime — 供 Host API 调用（ADR 0010 D3 Console API）。
 */

import type {
  AgentSessionStore,
  ContextRepository,
  MemoryAgentSessionStore,
  SessionBranchPoint,
} from '@zhin.js/ai';
import {
  jumpToBranchIndexWithSummarization,
  switchActiveLeafWithBranchSummarization,
} from './zhin-agent/branch-summarization-runtime.js';
import type { ZhinAgentPrivate } from './zhin-agent/zhin-agent-private.js';

export interface SessionTreeRuntimeHandle {
  contextRepository: ContextRepository;
  agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  switchActiveLeaf(sessionId: string, messageId: number): Promise<boolean>;
  jumpToBranchIndex(sessionId: string, index: number): Promise<{ ok: boolean; message: string }>;
  listBranchPoints(sessionId: string): Promise<SessionBranchPoint[]>;
  resolveActiveSessionId(sessionKey: string): Promise<string | null>;
}

let runtime: SessionTreeRuntimeHandle | null = null;

export function setSessionTreeRuntime(handle: SessionTreeRuntimeHandle | null): void {
  runtime = handle;
}

export function getSessionTreeRuntime(): SessionTreeRuntimeHandle | null {
  return runtime;
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
