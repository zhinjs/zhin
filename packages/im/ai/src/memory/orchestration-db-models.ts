/**
 * Orchestration persistence models — Agent Mesh hard orchestration v1.
 */

export type OrchestrationAgentRole =
  | 'main'
  | 'subtask'
  | 'worker'
  | 'researcher'
  | 'executor'
  | 'reviewer'
  | 'planner'
  | 'validator';

export type OrchestrationTaskPhase =
  | 'plan'
  | 'spec'
  | 'develop'
  | 'validate'
  | 'negotiate'
  | 'done'
  | '';

export type OrchestrationRunStatus = 'active' | 'completed' | 'cancelled' | 'failed';

export type OrchestrationTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type OrchestrationExecutorKind = 'local' | 'remote';

export const ORCHESTRATION_RUN_MODEL = {
  id: { type: 'text' as const, nullable: false },
  session_key: { type: 'text' as const, nullable: false },
  status: { type: 'text' as const, default: 'active' },
  title: { type: 'text' as const, default: '' },
  template: { type: 'text' as const, default: '' },
  mission_state_json: { type: 'text' as const, default: '' },
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

export interface OrchestrationRunRecord {
  id: string;
  session_key: string;
  status: OrchestrationRunStatus;
  title: string;
  template: string;
  mission_state_json: string;
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

export interface CreateOrchestrationRunInput {
  session_key: string;
  title?: string;
  template?: string;
}

export interface CreateOrchestrationTaskInput {
  run_id: string;
  name: string;
  description?: string;
  role?: OrchestrationAgentRole;
  goal?: string;
  depends_on?: string[];
  executor_kind?: OrchestrationExecutorKind;
  remote_agent_id?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
  is_writer?: boolean;
  phase?: OrchestrationTaskPhase;
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
