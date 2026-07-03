/**
 * activeDelegation.requireArtifact 硬门控。
 */
import type { CollaborationScene, PipelineArtifactKind } from './types.js';
import { getPipelineService } from '../aop/pipeline/pipeline-service.js';
import { findActiveDelegation } from './delegation-state.js';

export interface DelegationArtifactGateResult {
  ok: boolean;
  missing?: PipelineArtifactKind[];
}

export async function delegationArtifactsSatisfied(
  cell: CollaborationScene,
  endpointId: string,
): Promise<DelegationArtifactGateResult> {
  const delegation = findActiveDelegation(cell, endpointId);
  if (!delegation?.requireArtifact) return { ok: true };
  const kinds = delegation.artifactKinds;
  if (!kinds?.length) return { ok: false, missing: kinds };

  const runId = delegation.runId || cell.pipelineState?.runId;
  if (!runId) return { ok: false, missing: kinds };

  const artifacts = await getPipelineService().readArtifacts(cell.id, runId, kinds);
  const present = new Set(artifacts.map((a) => a.kind));
  const missing = kinds.filter((k) => !present.has(k));
  return missing.length ? { ok: false, missing } : { ok: true };
}
