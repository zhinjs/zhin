/**
 * collaboration_cells + collaboration_cell_members — GroupCell 持久化（ADR 0023）
 */

export const COLLABORATION_CELL_MODEL = {
  id: { type: 'text' as const, nullable: false },
  adapter: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  goal: { type: 'text' as const, default: '' },
  mission_run_id: { type: 'text' as const, default: '' },
  /** Pipeline 状态机 JSON（ADR 0024 D4）；空串表示尚未初始化。 */
  pipeline_state: { type: 'text' as const, default: '' },
  /** RosterRound 轮流发言 JSON（ADR 0026）；空串表示未激活。 */
  round_state: { type: 'text' as const, default: '' },
  version: { type: 'integer' as const, default: 0 },
  enabled: { type: 'integer' as const, default: 1 },
  created_at: { type: 'integer' as const, default: 0 },
  updated_at: { type: 'integer' as const, default: 0 },
};

export const COLLABORATION_CELL_MEMBER_MODEL = {
  cell_id: { type: 'text' as const, nullable: false },
  endpoint_id: { type: 'text' as const, nullable: false },
  /** 成员 transport adapter；空串表示继承 Cell.adapter */
  adapter: { type: 'text' as const, default: '' },
  primary: { type: 'text' as const, nullable: false },
  role: { type: 'text' as const, default: '' },
  /** Five-Agent pipeline 角色（ADR 0024 D3）。 */
  pipeline_role: { type: 'text' as const, default: '' },
  sort_order: { type: 'integer' as const, default: 0 },
  enabled: { type: 'integer' as const, default: 1 },
  created_at: { type: 'integer' as const, default: 0 },
  updated_at: { type: 'integer' as const, default: 0 },
};

/** Pipeline 阶段产物表（ADR 0024 D4）。 */
export const COLLABORATION_CELL_ARTIFACT_MODEL = {
  id: { type: 'text' as const, nullable: false },
  cell_id: { type: 'text' as const, nullable: false },
  run_id: { type: 'text' as const, default: '' },
  stage: { type: 'text' as const, default: '' },
  kind: { type: 'text' as const, default: '' },
  payload: { type: 'text' as const, default: '' },
  created_by_endpoint: { type: 'text' as const, default: '' },
  created_at: { type: 'integer' as const, default: 0 },
};

export interface CollaborationCellArtifactRow {
  id: string;
  cell_id: string;
  run_id: string;
  stage: string;
  kind: string;
  payload: string;
  created_by_endpoint: string;
  created_at: number;
}

export interface CollaborationCellRecord {
  id: string;
  adapter: string;
  scene_id: string;
  goal: string;
  mission_run_id: string;
  pipeline_state: string;
  round_state: string;
  version: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface CollaborationCellMemberRow {
  cell_id: string;
  endpoint_id: string;
  adapter: string;
  primary: string;
  role: string;
  pipeline_role: string;
  sort_order: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface CollaborationCellMemberRecord {
  endpointId: string;
  adapter?: string;
  primary: string;
  role?: string;
  pipelineRole?: string;
  sortOrder?: number;
  enabled?: boolean;
}

export interface UpsertCollaborationCellInput {
  id: string;
  adapter: string;
  sceneId: string;
  goal?: string;
  missionRunId?: string;
  pipelineState?: string;
  roundState?: string;
  members?: CollaborationCellMemberRecord[];
  enabled?: boolean;
}

export interface UpsertCollaborationMemberInput {
  endpointId: string;
  adapter?: string;
  primary: string;
  role?: string;
  pipelineRole?: string;
  sortOrder?: number;
  enabled?: boolean;
}

export function memberRowToRecord(row: CollaborationCellMemberRow): CollaborationCellMemberRecord {
  return {
    endpointId: row.endpoint_id,
    adapter: row.adapter || undefined,
    primary: row.primary,
    role: row.role || undefined,
    pipelineRole: row.pipeline_role || undefined,
    sortOrder: row.sort_order,
    enabled: row.enabled !== 0,
  };
}

export function memberInputToRow(
  cellId: string,
  input: UpsertCollaborationMemberInput,
  now = Date.now(),
  existing?: CollaborationCellMemberRow,
): CollaborationCellMemberRow {
  return {
    cell_id: cellId,
    endpoint_id: input.endpointId,
    adapter: input.adapter ?? existing?.adapter ?? '',
    primary: input.primary,
    role: input.role ?? existing?.role ?? '',
    pipeline_role: input.pipelineRole ?? existing?.pipeline_role ?? '',
    sort_order: input.sortOrder ?? existing?.sort_order ?? 0,
    enabled: input.enabled == null ? existing?.enabled ?? 1 : input.enabled === false ? 0 : 1,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

export const COLLABORATION_CELL_SCENE_MODEL = {
  logical_cell_id: { type: 'text' as const, nullable: false },
  adapter: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  created_at: { type: 'integer' as const, default: 0 },
};

export const COLLABORATION_INIT_SESSION_MODEL = {
  id: { type: 'text' as const, nullable: false },
  logical_cell_id: { type: 'text' as const, default: '' },
  planner_endpoint_id: { type: 'text' as const, nullable: false },
  planner_adapter: { type: 'text' as const, nullable: false },
  planner_scene_id: { type: 'text' as const, default: '' },
  status: { type: 'text' as const, default: 'wizard' },
  wizard_step: { type: 'text' as const, default: '' },
  created_at: { type: 'integer' as const, default: 0 },
  updated_at: { type: 'integer' as const, default: 0 },
};

export const COLLABORATION_INIT_OBSERVATION_MODEL = {
  session_id: { type: 'text' as const, nullable: false },
  observer_endpoint_id: { type: 'text' as const, nullable: false },
  observer_adapter: { type: 'text' as const, nullable: false },
  observer_scene_id: { type: 'text' as const, nullable: false },
  at_target_platform_id: { type: 'text' as const, nullable: false },
  wizard_step: { type: 'text' as const, default: '' },
  observed_at: { type: 'integer' as const, default: 0 },
};

export interface CollaborationCellSceneRow {
  logical_cell_id: string;
  adapter: string;
  scene_id: string;
  created_at: number;
}

export interface CollaborationInitSessionRow {
  id: string;
  logical_cell_id: string;
  planner_endpoint_id: string;
  planner_adapter: string;
  planner_scene_id: string;
  status: string;
  wizard_step: string;
  created_at: number;
  updated_at: number;
}

export type InitSessionStatus = 'wizard' | 'aggregating' | 'active' | 'cancelled';

export const WIZARD_STEPS = ['researcher', 'evaluator', 'executor', 'reviewer', 'done'] as const;
export type WizardStep = typeof WIZARD_STEPS[number];

/** 可分配角色的向导步骤（不含 done）。 */
export const ASSIGNABLE_WIZARD_ROLES = ['researcher', 'evaluator', 'executor', 'reviewer'] as const;
export type AssignableWizardRole = typeof ASSIGNABLE_WIZARD_ROLES[number];

export function isWizardStep(value: unknown): value is WizardStep {
  return typeof value === 'string' && (WIZARD_STEPS as readonly string[]).includes(value);
}

export function isAssignableWizardRole(value: unknown): value is AssignableWizardRole {
  return typeof value === 'string' && (ASSIGNABLE_WIZARD_ROLES as readonly string[]).includes(value);
}

export interface CollaborationInitObservationRow {
  session_id: string;
  observer_endpoint_id: string;
  observer_adapter: string;
  observer_scene_id: string;
  at_target_platform_id: string;
  wizard_step: string;
  observed_at: number;
}

/** 成员跨 adapter 身份表（identity 边表）。 */
export const COLLABORATION_CELL_MEMBER_CHANNEL_MODEL = {
  logical_cell_id: { type: 'text' as const, nullable: false },
  endpoint_id: { type: 'text' as const, nullable: false },
  pipeline_role: { type: 'text' as const, default: '' },
  adapter: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  bot_id: { type: 'text' as const, nullable: false },
  created_at: { type: 'integer' as const, default: 0 },
};

export interface CollaborationCellMemberChannelRow {
  logical_cell_id: string;
  endpoint_id: string;
  pipeline_role: string;
  adapter: string;
  scene_id: string;
  bot_id: string;
  created_at: number;
}
