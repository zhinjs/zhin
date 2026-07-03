/**
 * Planner 传输层 @ 出站 → 同步 activeDelegations（legacy；kernel 就绪时 no-op）。
 * @deprecated ADR 0027 — 委派状态由 OrchestrationKernel group_mention task 承载。
 */
import type { MessageElement } from '@zhin.js/core';
import { getCollaborationCellService } from './cell-service.js';
import type { CollaborationCell, ActiveDelegation } from './types.js';
import { resolvePlannerEndpointId } from './collaboration-delegation.js';
import { isPlannerDelegateBatch } from './planner-outbound-normalize.js';
import { segmentsMentionEndpoint } from './collaboration-outbound.js';
import { resolveTargetRole, replaceCeremonyDelegation, upsertActiveDelegation } from './delegation-state.js';
import type { GroupMessageAdapterView } from './group-message.js';
import { isOrchestrationKernelReady } from './collaboration-kernel-bridge.js';

function delegateTextFromBatch(batch: MessageElement[]): string {
  return batch
    .filter((seg) => seg.type === 'text' && seg.data?.text != null)
    .map((seg) => String(seg.data!.text).trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function applyTransportDelegations(
  cell: CollaborationCell,
  plannerEndpointId: string,
  batches: MessageElement[][],
  adapter: GroupMessageAdapterView,
  delegations: ActiveDelegation[],
): { delegations: ActiveDelegation[]; changed: boolean } {
  let next = delegations;
  let changed = false;
  const runId = cell.pipelineState?.runId;
  if (!runId) return { delegations: next, changed: false };

  for (const batch of batches) {
    if (!isPlannerDelegateBatch(batch, cell, plannerEndpointId, adapter)) continue;
    const text = delegateTextFromBatch(batch) || '请处理。';
    let ceremonyAssignedInBatch = false;
    for (const member of cell.members) {
      if (member.endpointId === plannerEndpointId) continue;
      if (!segmentsMentionEndpoint(batch, member.endpointId, adapter, cell)) continue;
      const role = resolveTargetRole(cell, member.endpointId);
      if (!role) continue;
      const existing = next.find((d) => d.targetEndpointId === member.endpointId);
      if (existing?.mode === 'pipeline' && existing.requireArtifact) {
        next = upsertActiveDelegation(next, {
          ...existing,
          delegateText: text || existing.delegateText,
          updatedAt: Date.now(),
        });
        changed = true;
        continue;
      }
      if (ceremonyAssignedInBatch) continue;
      ceremonyAssignedInBatch = true;
      next = replaceCeremonyDelegation(next, {
        targetEndpointId: member.endpointId,
        targetRole: role,
        runId,
        requireArtifact: false,
        mode: 'ceremony',
        delegateText: text,
        updatedAt: Date.now(),
      });
      changed = true;
    }
  }
  return { delegations: next, changed };
}

export async function syncPlannerTransportDelegations(
  cell: CollaborationCell,
  plannerEndpointId: string,
  batches: MessageElement[][],
  adapter: GroupMessageAdapterView,
): Promise<void> {
  if (isOrchestrationKernelReady()) return;
  if (resolvePlannerEndpointId(cell) !== plannerEndpointId) return;

  const svc = getCollaborationCellService();
  const fresh = (await svc.getCellFresh(cell.id)) ?? cell;
  if (!fresh.pipelineState) return;

  const preview = applyTransportDelegations(
    fresh,
    plannerEndpointId,
    batches,
    adapter,
    fresh.pipelineState.activeDelegations ?? [],
  );
  if (!preview.changed) return;

  await svc.patchPipelineState(fresh.id, (prev, cellAtWrite) => {
    if (!prev) return undefined;
    const applied = applyTransportDelegations(
      cellAtWrite,
      plannerEndpointId,
      batches,
      adapter,
      prev.activeDelegations ?? [],
    );
    if (!applied.changed) return undefined;
    return {
      ...prev,
      activeDelegations: applied.delegations,
      updatedAt: Date.now(),
    };
  });
}
