/**
 * Branch summarization helpers — ADR 0010 D3.
 */

import type { AgentMessage, UserMessage } from '../llm/types/agent-message.js';
import { createUserMessage } from '../llm/types/agent-message.js';
import type { AgentMessageRow } from './agent-db-models.js';
import { agentMessageRowToLlm } from './agent-db-models.js';
import { buildActivePathRows } from './session-tree.js';

export const BRANCH_SUMMARY_PREFIX = '[Alternate branch summary]\n';

/** Rows abandoned when switching active_leaf from oldLeaf to newLeaf. */
export function collectAbandonedPathRows(
  allRows: AgentMessageRow[],
  oldLeafId: number | null | undefined,
  newLeafId: number,
): AgentMessageRow[] {
  if (oldLeafId == null || oldLeafId === newLeafId) return [];
  const oldPath = buildActivePathRows(allRows, oldLeafId);
  const forkIdx = oldPath.findIndex(r => r.id === newLeafId);
  if (forkIdx < 0) return [];
  return oldPath.slice(forkIdx + 1);
}

export function abandonedRowsToMessages(rows: AgentMessageRow[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const row of rows) {
    const parsed = agentMessageRowToLlm(row);
    if (parsed) messages.push(parsed);
  }
  return messages;
}

export function branchSummaryAsUserMessage(summary: string, createdAt = Date.now()): UserMessage {
  return createUserMessage(`${BRANCH_SUMMARY_PREFIX}${summary}`, undefined, createdAt);
}
