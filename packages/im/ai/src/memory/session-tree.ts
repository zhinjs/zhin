import type { AgentMessage, UserMessage } from '../llm/types/agent-message.js';
import { type AgentMessageRow, parseAgentMessageRow } from './agent-db-models.js';
import {
  parseAgentMessageExtra,
  stripSenderPrefixFromText,
  userMessagePlainText,
  type AgentMessageExtra,
} from './sender-extra.js';
export interface SessionBranchPoint {
  index: number;
  messageId: number;
  preview: string;
}

export function rowById(rows: AgentMessageRow[]): Map<number, AgentMessageRow> {
  const map = new Map<number, AgentMessageRow>();
  for (const row of rows) {
    if (row.id != null) map.set(row.id, row);
  }
  return map;
}

export function resolveDefaultLeafId(rows: AgentMessageRow[]): number | undefined {
  if (rows.length === 0) return undefined;
  const sorted = [...rows].sort(
    (a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0),
  );
  return sorted[sorted.length - 1]?.id;
}

/** Walk from leaf to root; returns chronological path (root → leaf). */
export function buildActivePathRows(
  rows: AgentMessageRow[],
  activeLeafId?: number | null,
): AgentMessageRow[] {
  if (rows.length === 0) return [];
  const byId = rowById(rows);
  const leafId = activeLeafId ?? resolveDefaultLeafId(rows);
  if (leafId == null) return rows;

  const chain: AgentMessageRow[] = [];
  const visited = new Set<number>();
  let current = byId.get(leafId);
  while (current && current.id != null && !visited.has(current.id)) {
    visited.add(current.id);
    chain.push(current);
    if (current.parent_id == null) break;
    current = byId.get(current.parent_id);
  }
  return chain.reverse();
}

export function sortRowsChronologically(rows: AgentMessageRow[]): AgentMessageRow[] {
  return [...rows].sort(
    (a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0),
  );
}

function userPreview(message: AgentMessage, extra?: AgentMessageExtra): string {
  if (message.role !== 'user') return '';
  const text = userMessagePlainText(message as UserMessage);
  const body = extra?.sender ? text : stripSenderPrefixFromText(text).body;
  const name = extra?.sender?.name?.trim();
  const display = name && name !== 'unknown' ? `${name}: ${body}` : body;
  return display.slice(0, 80);
}

/** List user messages on active path for /tree navigation. */
export function listUserBranchPoints(pathRows: AgentMessageRow[]): SessionBranchPoint[] {
  const points: SessionBranchPoint[] = [];
  let index = 0;
  for (const row of pathRows) {
    const parsed = parseAgentMessageRow(row);
    if (!parsed || parsed.role !== 'user' || row.id == null) continue;
    index += 1;
    const extra = parseAgentMessageExtra(row.extra);
    points.push({
      index,
      messageId: row.id,
      preview: userPreview(parsed, extra) || `(user #${index})`,
    });
  }
  return points;
}
