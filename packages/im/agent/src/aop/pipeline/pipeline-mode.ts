/**
 * Pipeline 模式探测（ADR 0024 #10）：
 * - full：Cell 成员齐 5 个 pipelineRole（群 5 Endpoint）
 * - compact：私聊/单 Bot/成员不齐（Planner 可短路）
 */
import { PIPELINE_ROLES, type CollaborationCell } from '../../collaboration/types.js';
import type { PipelineProfile } from './pipeline-transitions.js';

export function cellHasFiveRoles(cell: CollaborationCell | undefined): boolean {
  if (!cell) return false;
  const roles = new Set(cell.members.map((m) => m.pipelineRole).filter(Boolean));
  return PIPELINE_ROLES.every((r) => roles.has(r));
}

export function detectPipelineProfile(cell: CollaborationCell | undefined): PipelineProfile {
  return cellHasFiveRoles(cell) ? 'full' : 'compact';
}
