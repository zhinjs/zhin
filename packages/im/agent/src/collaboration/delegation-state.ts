/**
 * activeDelegations 状态读写（Planner group_delegate SSOT）。
 */
import type {
  ActiveDelegation,
  CollaborationCell,
  PipelineArtifactKind,
  PipelineRole,
} from './types.js';
import { resolvePlannerEndpointId } from './collaboration-delegation.js';

/** pipeline 模式委派时默认要求的产物种类（requireArtifact 未显式 true 时自动补齐）。 */
export function defaultArtifactKindsForRole(role: PipelineRole): PipelineArtifactKind[] {
  switch (role) {
    case 'researcher': return ['report', 'citations'];
    case 'evaluator': return ['blueprint'];
    case 'executor': return ['deliverable'];
    case 'reviewer': return ['review'];
    default: return [];
  }
}

export function findActiveDelegation(
  cell: CollaborationCell | undefined,
  endpointId: string,
): ActiveDelegation | undefined {
  const list = cell?.pipelineState?.activeDelegations;
  return list?.find((d) => d.targetEndpointId === endpointId);
}

export function isActiveDelegatee(
  cell: CollaborationCell | undefined,
  endpointId: string,
): boolean {
  if (!cell) return false;
  const plannerId = resolvePlannerEndpointId(cell);
  if (!plannerId || endpointId === plannerId) return false;
  return Boolean(findActiveDelegation(cell, endpointId));
}

export function upsertActiveDelegation(
  delegations: ActiveDelegation[] | undefined,
  entry: ActiveDelegation,
): ActiveDelegation[] {
  const rest = (delegations ?? []).filter((d) => d.targetEndpointId !== entry.targetEndpointId);
  return [...rest, entry];
}

export function removeActiveDelegationForEndpoint(
  delegations: ActiveDelegation[] | undefined,
  endpointId: string,
  runId?: string,
): ActiveDelegation[] {
  return (delegations ?? []).filter((d) => {
    if (d.targetEndpointId !== endpointId) return true;
    if (runId && d.runId !== runId) return true;
    return false;
  });
}

export function isValidArtifactKind(value: unknown): value is PipelineArtifactKind {
  return typeof value === 'string'
    && ['report', 'blueprint', 'deliverable', 'review', 'citations'].includes(value);
}

export function parseArtifactKinds(raw: unknown): PipelineArtifactKind[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kinds = raw.filter(isValidArtifactKind);
  return kinds.length ? kinds : undefined;
}

export function resolveTargetRole(
  cell: CollaborationCell,
  endpointId: string,
): PipelineRole | undefined {
  return cell.members.find((m) => m.endpointId === endpointId)?.pipelineRole;
}

/** 最近归档 run 上是否仍有该 endpoint 的未完成委派（create/reset 后 in-flight）。 */
export function findInFlightArchivedRunId(
  cell: CollaborationCell | undefined,
  endpointId: string,
): string | undefined {
  const history = cell?.pipelineState?.runHistory;
  if (!history?.length) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const archive = history[i]!;
    const had = archive.activeDelegationsAtArchive?.some((d) => d.targetEndpointId === endpointId);
    if (had) return archive.runId;
  }
  return undefined;
}

/**
 * 产物提交应写入的 runId：
 * 1) 活跃委派绑定的 runId；2) 归档 run 上 in-flight 委派；3) 当前 active run。
 */
export function resolveArtifactSubmitRunId(
  cell: CollaborationCell | undefined,
  endpointId: string,
  opts?: { turnDelegationRunId?: string },
): { ok: true; runId: string; reason: 'turn_snapshot_delegation' | 'active_delegation' | 'in_flight_archive' | 'current_run' } | { ok: false; error: string } {
  const state = cell?.pipelineState;
  if (!state) return { ok: false, error: 'pipeline 未初始化' };

  const snapRun = opts?.turnDelegationRunId?.trim();
  if (snapRun) {
    return { ok: true, runId: snapRun, reason: 'turn_snapshot_delegation' };
  }

  const delegation = findActiveDelegation(cell, endpointId);
  if (delegation) {
    const runId = delegation.runId || state.runId;
    return { ok: true, runId, reason: 'active_delegation' };
  }

  const inFlight = findInFlightArchivedRunId(cell, endpointId);
  if (inFlight && inFlight !== state.runId) {
    return { ok: true, runId: inFlight, reason: 'in_flight_archive' };
  }

  return { ok: true, runId: state.runId, reason: 'current_run' };
}
