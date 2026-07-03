/**
 * Orchestration persistence models — Agent Run kernel.
 */

export type OrchestrationAgentRole =
  | 'subtask'
  | 'worker'
  | 'researcher'
  | 'evaluator'
  | 'executor'
  | 'reviewer'
  | 'planner';

export type OrchestrationTaskPhase = string;

export type OrchestrationRunStatus =
  | 'open'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type OrchestrationTaskStatus =
  | 'pending'
  | 'assigned'
  | 'running'
  | 'waiting_result'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type OrchestrationExecutorKind = 'local' | 'scene_mention' | 'remote_mesh';

export type OrchestrationSceneKind = 'private' | 'group' | 'channel';

export interface OrchestrationSceneRef {
  platform: string;
  endpointId: string;
  sceneId: string;
  kind: OrchestrationSceneKind;
  senderId?: string;
  parent?: { kind: Extract<OrchestrationSceneKind, 'group' | 'channel'>; sceneId: string };
}

export type OrchestrationRunSource =
  | { kind: 'im_scene'; scene: OrchestrationSceneRef; cellId?: string }
  | { kind: 'manual'; label?: string };

export type OrchestrationRunEventType =
  | 'run.started'
  | 'run.status_changed'
  | 'task.created'
  | 'task.assigned'
  | 'task.started'
  | 'task.thinking'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'result.returned';

export const ORCHESTRATION_RUN_MODEL = {
  id: { type: 'text' as const, nullable: false },
  session_key: { type: 'text' as const, nullable: false },
  status: { type: 'text' as const, default: 'open' },
  title: { type: 'text' as const, default: '' },
  template: { type: 'text' as const, default: '' },
  source_json: { type: 'text' as const, default: '' },
  state_json: { type: 'text' as const, default: '' },
  state_version: { type: 'integer' as const, default: 0 },
  created_at: { type: 'integer' as const, default: 0 },
  updated_at: { type: 'integer' as const, default: 0 },
};

export const ORCHESTRATION_TASK_MODEL = {
  id: { type: 'text' as const, nullable: false },
  run_id: { type: 'text' as const, nullable: false },
  name: { type: 'text' as const, nullable: false },
  description: { type: 'text' as const, default: '' },
  role: { type: 'text' as const, default: 'subtask' },
  goal: { type: 'text' as const, default: '' },
  status: { type: 'text' as const, default: 'pending' },
  depends_on: { type: 'text' as const, default: '[]' },
  executor_kind: { type: 'text' as const, default: 'local' },
  assigned_to: { type: 'text' as const, default: '' },
  remote_agent_id: { type: 'text' as const, default: '' },
  remote_task_id: { type: 'text' as const, default: '' },
  priority: { type: 'text' as const, default: 'medium' },
  context_json: { type: 'text' as const, default: '' },
  is_writer: { type: 'integer' as const, default: 0 },
  phase: { type: 'text' as const, default: '' },
  result_summary: { type: 'text' as const, default: '' },
  error: { type: 'text' as const, default: '' },
  created_at: { type: 'integer' as const, default: 0 },
  updated_at: { type: 'integer' as const, default: 0 },
  started_at: { type: 'integer' as const, nullable: true },
  finished_at: { type: 'integer' as const, nullable: true },
};

export const ORCHESTRATION_EVENT_MODEL = {
  id: { type: 'text' as const, nullable: false },
  run_id: { type: 'text' as const, nullable: false },
  task_id: { type: 'text' as const, default: '' },
  type: { type: 'text' as const, nullable: false },
  seq: { type: 'integer' as const, default: 0 },
  payload_json: { type: 'text' as const, default: '{}' },
  created_at: { type: 'integer' as const, default: 0 },
};

export interface OrchestrationRunRecord {
  id: string;
  session_key: string;
  status: OrchestrationRunStatus;
  title: string;
  template: string;
  source_json: string;
  state_json: string;
  state_version: number;
  created_at: number;
  updated_at: number;
}

export interface OrchestrationTaskRecord {
  id: string;
  run_id: string;
  name: string;
  description: string;
  role: OrchestrationAgentRole;
  goal: string;
  status: OrchestrationTaskStatus;
  depends_on: string;
  executor_kind: OrchestrationExecutorKind;
  assigned_to: string;
  remote_agent_id: string;
  remote_task_id: string;
  priority: string;
  context_json: string;
  is_writer: number;
  phase: OrchestrationTaskPhase;
  result_summary: string;
  error: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface OrchestrationEventRecord {
  id: string;
  run_id: string;
  task_id: string;
  type: OrchestrationRunEventType;
  seq: number;
  payload_json: string;
  created_at: number;
}

export interface CreateOrchestrationRunInput {
  session_key: string;
  title?: string;
  template?: string;
  source?: OrchestrationRunSource;
  state?: Record<string, unknown>;
}

export interface CreateOrchestrationTaskInput {
  run_id: string;
  name: string;
  description?: string;
  role?: OrchestrationAgentRole;
  goal?: string;
  depends_on?: string[];
  executor_kind?: OrchestrationExecutorKind;
  assigned_to?: string;
  remote_agent_id?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
  is_writer?: boolean;
  phase?: OrchestrationTaskPhase;
}

export interface CreateOrchestrationEventInput {
  run_id: string;
  task_id?: string;
  type: OrchestrationRunEventType;
  payload?: Record<string, unknown>;
}

export function parseDependsOn(json: string): string[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function serializeDependsOn(ids: string[]): string {
  return JSON.stringify(ids ?? []);
}
