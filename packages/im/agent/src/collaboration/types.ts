/**
 * Collaboration domain types — GroupCell multi-endpoint agent orchestration.
 * @see docs/adr/0023-group-cell-multi-endpoint-agents.md
 */

export type DelegationMode = 'local_process' | 'spawn_task' | 'im_mention' | 'mesh_remote';

export type PeerTriggerMode = 'mention-only' | 'off';

/** Five-Agent 企业管理矩阵角色（ADR 0024）。 */
export type PipelineRole = 'planner' | 'researcher' | 'evaluator' | 'executor' | 'reviewer';

export const PIPELINE_ROLES: readonly PipelineRole[] = [
  'planner',
  'researcher',
  'evaluator',
  'executor',
  'reviewer',
];

export function isPipelineRole(value: unknown): value is PipelineRole {
  return typeof value === 'string' && (PIPELINE_ROLES as readonly string[]).includes(value);
}

/** Pipeline 阶段；与角色一一对应 + done/failed 终态。 */
export type PipelineStage = PipelineRole | 'done' | 'failed';

/** Artifact 种类：阶段产物的结构化类型。 */
export type PipelineArtifactKind =
  | 'report' // researcher 检索报告（含 citations）
  | 'blueprint' // evaluator 决策蓝图（仅 decision，不含 raw CoT）
  | 'deliverable' // executor 物理产出
  | 'review' // reviewer 质检结论
  | 'citations'; // 引用清单（供 reviewer 对账）

export interface PipelineArtifact {
  id: string;
  cellId: string;
  runId: string;
  stage: PipelineStage;
  kind: PipelineArtifactKind;
  payload: Record<string, unknown>;
  createdByEndpoint?: string;
  createdAt: number;
}

export interface PipelineTodoItem {
  id: string;
  text: string;
  done?: boolean;
}

/** 归档的 pipeline run 快照（Planner 可 activate 恢复）。 */
export interface PipelineRunArchive {
  runId: string;
  label?: string;
  userGoal?: string;
  stage: PipelineStage;
  reviewCycles: number;
  todo: PipelineTodoItem[];
  /** 归档时刻未完成的委派（供 in-flight 产物路由回原 run） */
  activeDelegationsAtArchive?: ActiveDelegation[];
  createdAt: number;
  archivedAt: number;
}

export type PipelineManageAction = 'create' | 'reset' | 'update' | 'activate' | 'list';

export interface ActiveDelegation {
  targetEndpointId: string;
  targetRole: PipelineRole;
  /** 委派创建时的 pipeline runId（产物提交 SSOT，防 reset 竞态） */
  runId: string;
  requireArtifact: boolean;
  artifactKinds?: PipelineArtifactKind[];
  /** @deprecated Legacy planner metadata; OrchestrationKernel tasks carry executor/workflow state. */
  mode?: string;
  delegateText: string;
  updatedAt: number;
}

/** 挂在 Cell 上的流水线状态机（SSOT，ADR 0024 D4）。 */
export interface PipelineState {
  runId: string;
  /** 人类可读流程名（Planner 通过 cell_manage_pipeline 设置） */
  runLabel?: string;
  runCreatedAt?: number;
  stage: PipelineStage;
  reviewCycles: number;
  maxReviewCycles: number;
  allowedNextStages: PipelineStage[];
  todo: PipelineTodoItem[];
  userGoal?: string;
  /** 已归档 run（不含当前 active runId） */
  runHistory?: PipelineRunArchive[];
  /** @deprecated ADR 0027: 委派状态由 kernel task 管理，不再写入 cell.pipelineState.activeDelegations。 */
  activeDelegations?: ActiveDelegation[];
  /** @deprecated 使用 activeDelegations */
  pendingDelegateTarget?: string;
  /** @deprecated 使用 activeDelegations[].delegateText */
  taskBrief?: string;
  updatedAt: number;
}

export const DEFAULT_MAX_REVIEW_CYCLES = 3;

export interface CollaborationCellMember {
  endpoint: string;
  primary: string;
  role?: string;
  pipelineRole?: PipelineRole;
}

export interface CollaborationCellConfig {
  id: string;
  adapter: string;
  sceneId: string;
  goal?: string;
  missionRunId?: string;
  members: CollaborationCellMember[];
}

export interface CollaborationConfig {
  /** 启用协作平面（单元数据存数据库） */
  enabled?: boolean;
  /** /collab init 默认协作目标 */
  defaultGoal?: string;
  /**
   * 按 adapter 的默认成员模板；仅在使用 /collab init 时挂载，不自动导入。
   * 示例：roster.icqq[].endpoint / primary / pipelineRole
   */
  roster?: Record<string, CollaborationCellMember[]>;
}

export interface CollaborationCellMemberRuntime {
  endpointId: string;
  /** 成员所属 adapter；缺省与 Cell.adapter 相同（跨 adapter 同群协作时显式填写）。 */
  adapter?: string;
  primary: string;
  role?: string;
  pipelineRole?: PipelineRole;
}

export interface CollaborationCell {
  id: string;
  adapter: string;
  sceneId: string;
  goal?: string;
  missionRunId?: string;
  members: CollaborationCellMemberRuntime[];
  pipelineState?: PipelineState;
  version?: number;
}

export interface TurnPlanDelegation {
  mode: DelegationMode;
  targetEndpointId?: string;
  targetAgentId?: string;
}

export interface TurnPlan {
  inboundEndpointId: string;
  handlerProfile: string;
  outboundEndpointId: string;
  cellId?: string;
  sessionKeys: {
    transport: string;
    cell?: string;
  };
  delegation?: TurnPlanDelegation;
}

export interface PeerTriggerResult {
  isPeer: boolean;
  peerEndpointId?: string;
  shouldTrigger: boolean;
  reason?: string;
}
