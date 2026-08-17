/**
 * 协作群 Agent 会话 key：按 pipeline run 隔离，避免 reset 后旧 IM 上下文污染新 run。
 */
import { resolveIMSessionIdFromMessage, type Message } from '@zhin.js/core';
import type { CollaborationScene } from './types.js';
import { resolveRunIdRef } from '../aop/pipeline/pipeline-flow.js';
import { readCollaborationTurnSnapshot } from './collaboration-turn-snapshot.js';
import { resolveCollaborationSceneForMessage } from './collaboration-context.js';
import { findActiveDelegation } from './delegation-state.js';
function pipelinePrefixedSessionKey(transport: string, bindRun: string): string {
  return `pipeline:${bindRun.slice(0, 8)}:${transport}`;
}

function resolveBindRunFromCell(cell: CollaborationScene, endpointKey: string): string | undefined {
  const runId = cell.pipelineState?.runId;
  if (!runId) return undefined;
  const delegation = findActiveDelegation(cell, endpointKey);
  return delegation?.runId ?? runId;
}

export interface AgentTurnSessionAddress {
  readonly transport: string;
  readonly endpointKey: string;
  readonly runId?: string;
  readonly delegationRunId?: string;
}

/** Origin-neutral session key resolver used by IM ingress adapters. */
export function resolveAgentTurnSessionKeyFromAddress(
  address: AgentTurnSessionAddress,
  cell?: CollaborationScene,
): string {
  if (address.runId) {
    return pipelinePrefixedSessionKey(
      address.transport,
      address.delegationRunId ?? address.runId,
    );
  }
  if (!cell) return address.transport;
  const bindRun = resolveBindRunFromCell(cell, address.endpointKey);
  return bindRun ? pipelinePrefixedSessionKey(address.transport, bindRun) : address.transport;
}

/**
 * Agent turn 级 session key SSOT（IM transport + 可选 pipeline run 隔离）。
 * passive write / @ drain / auto-continue depth / persist 须共用此函数。
 */
export function resolveAgentTurnSessionKey(
  message: Message,
  cell?: CollaborationScene,
): string {
  const transport = resolveIMSessionIdFromMessage(message);
  const snap = readCollaborationTurnSnapshot(message);
  const resolvedCell = cell ?? resolveCollaborationSceneForMessage(message);
  return resolveAgentTurnSessionKeyFromAddress({
    transport,
    endpointKey: String(message.$endpoint ?? ''),
    ...(snap?.runId ? { runId: snap.runId } : {}),
    ...(snap?.delegationRunId ? { delegationRunId: snap.delegationRunId } : {}),
  }, resolvedCell);
}

/** transport session + 可选 pipeline run 前缀（同 endpoint 不同 run 独立 agent_messages）。 */
export function resolveAgentSessionKeyForTurn(
  message: Message,
  cell?: CollaborationScene,
): string {
  return resolveAgentTurnSessionKey(message, cell);
}

/** legacy pipeline run 解析（支持前缀）；新编排请用 missionRunId / orchestration_status。 */
export function resolveArtifactRunId(
  runRef: string | undefined,
  cell: CollaborationScene,
): { ok: true; runId: string } | { ok: false; error: string } {
  const state = cell.pipelineState;
  if (!state) return { ok: false, error: 'pipeline 未初始化' };
  if (!runRef?.trim()) return { ok: true, runId: state.runId };
  const resolved = resolveRunIdRef(runRef.trim(), state);
  if (resolved) return { ok: true, runId: resolved };
  if (state.runHistory?.some((h) => h.runId === runRef || h.runId.startsWith(runRef))) {
    const match = state.runHistory.find((h) => h.runId === runRef || h.runId.startsWith(runRef))!;
    return { ok: true, runId: match.runId };
  }
  return {
    ok: false,
    error: `runId ${runRef} 未找到；legacy pipeline 已弃用，请用 orchestration_status`,
  };
}
