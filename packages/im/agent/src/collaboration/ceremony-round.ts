/**
 * Ceremony 轮流发言 — 自我介绍/依次发言等，与 pipeline stage 正交。
 *
 * Read-only helpers: state writes are handled by the kernel (runRosterRound)
 * and the roster-round WorkflowStrategy, not by direct cell.pipelineState mutation.
 */
import type { CollaborationCell, PipelineRole } from './types.js';
import { detectCeremonyOrchestrationIntent } from './collaboration-context.js';

export const CEREMONY_ROSTER_ROLES: readonly PipelineRole[] = [
  'researcher',
  'evaluator',
  'executor',
  'reviewer',
];

export function isCeremonyGoal(cell: CollaborationCell): boolean {
  const goal = cell.pipelineState?.userGoal ?? cell.goal;
  return detectCeremonyOrchestrationIntent(goal);
}

export function isCeremonyActive(cell: CollaborationCell): boolean {
  if (isCeremonyGoal(cell)) return true;
  const spoken = cell.pipelineState?.ceremonySpoken?.length ?? 0;
  if (spoken > 0) return true;
  return (cell.pipelineState?.activeDelegations ?? []).some((d) => d.mode === 'ceremony');
}

export function resolveCeremonyRosterEndpointIds(cell: CollaborationCell): string[] {
  const ids: string[] = [];
  for (const role of CEREMONY_ROSTER_ROLES) {
    const ep = cell.members.find((m) => m.pipelineRole === role)?.endpointId;
    if (ep) ids.push(ep);
  }
  return ids;
}

export function resolveNextCeremonyEndpointId(
  cell: CollaborationCell,
  afterEndpointId?: string,
): string | undefined {
  const order = resolveCeremonyRosterEndpointIds(cell);
  const spoken = new Set(cell.pipelineState?.ceremonySpoken ?? []);
  if (!afterEndpointId) {
    return order.find((id) => !spoken.has(id));
  }
  const startIdx = order.indexOf(afterEndpointId);
  for (let i = startIdx + 1; i < order.length; i++) {
    const id = order[i]!;
    if (!spoken.has(id)) return id;
  }
  return undefined;
}

/** 公开自我介绍须为实质内容，不能只有「已完成」。 */
export function isSubstantiveCeremonyPublicReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^已完成[。.!！?？\s✅✓]*$/u.test(t)) return false;
  if (/^已完成/u.test(t) && t.length < 40) return false;
  return t.length >= 12;
}

export function ceremonyPingText(cell: CollaborationCell, targetEndpointId: string): string {
  const member = cell.members.find((m) => m.endpointId === targetEndpointId);
  const role = member?.pipelineRole ?? member?.primary ?? '成员';
  const goal = cell.pipelineState?.userGoal ?? cell.goal ?? '';
  if (/自我介绍|介绍一下/i.test(goal)) {
    return `请向大家做一段简短的自我介绍（2–4 句），说完后再 handback @Planner。`;
  }
  return `${role}，请按顺序发言（2–4 句公开回复），说完后再 handback @Planner。`;
}


