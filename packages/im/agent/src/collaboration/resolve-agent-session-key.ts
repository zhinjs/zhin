/**
 * 协作群 Agent 会话 key：按 pipeline run 隔离，避免 reset 后旧 IM 上下文污染新 run。
 */
import { resolveIMSessionIdFromMessage } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import type { CollaborationCell } from './types.js';
import { resolveRunIdRef } from '../aop/pipeline/pipeline-flow.js';

/** transport session + 可选 pipeline run 前缀（同 endpoint 不同 run 独立 agent_messages）。 */
export function resolveAgentSessionKeyForTurn(
  message: Message,
  cell?: CollaborationCell,
): string {
  const transport = resolveIMSessionIdFromMessage(message);
  const runId = cell?.pipelineState?.runId;
  if (!runId) return transport;
  const runPrefix = runId.slice(0, 8);
  return `pipeline:${runPrefix}:${transport}`;
}

/** cell_read_artifact / list 用的 runId 解析（支持前缀）。 */
export function resolveArtifactRunId(
  runRef: string | undefined,
  cell: CollaborationCell,
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
    error: `runId ${runRef} 未找到；用 cell_pipeline_status 查看 runs 列表`,
  };
}
