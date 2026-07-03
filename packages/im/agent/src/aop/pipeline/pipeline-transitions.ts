/**
 * Pipeline 阶段转移表（ADR 0024 D2-I3）。
 *
 * full：planner → researcher → evaluator → executor → reviewer → planner（回环）
 * reject：reviewer → researcher | evaluator（打回重做）
 * compact：planner 可短路直达 executor（私聊/单 Bot，仍受角色工具 ACL 约束）
 */
import type { PipelineStage } from '../../collaboration/types.js';

export type PipelineProfile = 'full' | 'compact';

const FULL_NEXT: Record<PipelineStage, PipelineStage[]> = {
  planner: ['researcher', 'done'],
  researcher: ['evaluator'],
  evaluator: ['executor'],
  executor: ['reviewer'],
  reviewer: ['planner', 'researcher', 'evaluator', 'done', 'failed'],
  done: [],
  failed: [],
};

const COMPACT_NEXT: Record<PipelineStage, PipelineStage[]> = {
  // compact 允许 Planner 智能短路（直接执行 / 跳过部分阶段）
  planner: ['researcher', 'evaluator', 'executor', 'done'],
  researcher: ['evaluator', 'executor'],
  evaluator: ['executor'],
  executor: ['reviewer', 'done'],
  reviewer: ['planner', 'executor', 'done', 'failed'],
  done: [],
  failed: [],
};

export function allowedNextStages(stage: PipelineStage, profile: PipelineProfile): PipelineStage[] {
  const table = profile === 'compact' ? COMPACT_NEXT : FULL_NEXT;
  return [...(table[stage] ?? [])];
}

export function isTransitionAllowed(
  from: PipelineStage,
  to: PipelineStage,
  profile: PipelineProfile,
): boolean {
  return allowedNextStages(from, profile).includes(to);
}

/** 是否为「打回重做」转移（reviewer → 更早阶段），用于扣减预算。 */
export function isRejectTransition(from: PipelineStage, to: PipelineStage): boolean {
  return from === 'reviewer' && (to === 'researcher' || to === 'evaluator' || to === 'planner' || to === 'executor');
}
