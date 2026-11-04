import { parseAgentMessageRow, type SessionBranchPoint, type UserMessage } from '@zhin.js/ai';
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
  readBranchMessage?(sessionId: string, messageId: number): Promise<string | null>;
  resolveActiveSessionId(sessionKey: string): Promise<string | null>;
}

export function createSessionTreeRuntimeFromAgent(
  host: ZhinAgentPrivate,
  withModelScope: <T>(operation: () => Promise<T>) => Promise<T> = operation => operation(),
): SessionTreeRuntimeHandle {
  return {
    getActiveLeafMessageId: async (sessionId) => {
      const session = await host.agentSessionStore.getBySessionId(sessionId);
      return session?.active_leaf_message_id ?? null;
    },
    switchActiveLeaf: (sessionId, messageId) =>
      withModelScope(() => switchActiveLeafWithBranchSummarization(host, sessionId, messageId)),
    jumpToBranchIndex: (sessionId, index) =>
      withModelScope(() => jumpToBranchIndexWithSummarization(host, sessionId, index)),
    listBranchPoints: (sessionId) => host.contextRepository.listBranchPoints(sessionId),
    readBranchMessage: async (sessionId, messageId) => {
      const rows = await host.contextRepository.loadMessageRows(sessionId);
      const row = rows.find(candidate => candidate.session_id === sessionId && candidate.id === messageId && candidate.role === 'user');
      if (!row) return null;
      const message = parseAgentMessageRow(row);
      if (message?.role !== 'user') return null;
      return (message as UserMessage).content
        .filter(block => block.type === 'text')
        .map(block => block.type === 'text' ? block.text : '')
        .join(' ');
    },
    resolveActiveSessionId: async (sessionKey) => {
      const active = await host.agentSessionStore.findActive(sessionKey);
      return active?.session_id ?? null;
    },
  };
}
