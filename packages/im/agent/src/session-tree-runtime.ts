import type { SessionBranchPoint } from '@zhin.js/ai';
import {
  jumpToBranchIndexWithSummarization,
  switchActiveLeafWithBranchSummarization,
} from './session/branch-summarization-runtime.js';
import type { ZhinAgentPrivate } from './internal/agent-host.js';

/** Generation-owned session-tree projection exposed through AgentHostPort. */
export interface SessionTreeRuntimeHandle {
  getActiveLeafMessageId(sessionId: string): Promise<number | null>;
  switchActiveLeaf(sessionId: string, messageId: number): Promise<boolean>;
  jumpToBranchIndex(sessionId: string, index: number): Promise<{ ok: boolean; message: string }>;
  listBranchPoints(sessionId: string): Promise<SessionBranchPoint[]>;
  resolveActiveSessionId(sessionKey: string): Promise<string | null>;
}

export function createSessionTreeRuntimeFromAgent(
  host: ZhinAgentPrivate,
): SessionTreeRuntimeHandle {
  return {
    getActiveLeafMessageId: async (sessionId) => {
      const session = await host.agentSessionStore.getBySessionId(sessionId);
      return session?.active_leaf_message_id ?? null;
    },
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
