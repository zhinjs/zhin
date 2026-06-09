/**
 * Mission State — Broadcast shared state for missions runs (ADR 0011).
 */
import type { OrchestrationRunRecord } from '@zhin.js/ai';

/** 唯一 Missions 模板（无 v1/v2 分叉） */
export const MISSIONS_TEMPLATE = 'missions';

export type MissionPhase = 'plan' | 'spec' | 'develop' | 'validate' | 'negotiate' | 'done';

export type MissionTaskPhase = MissionPhase;

export interface MissionValidationResult {
  passed: number;
  failed: number;
  failed_ids: string[];
}

export interface MissionDecisionLogEntry {
  at: number;
  actor: string;
  action: string;
  reason: string;
}

export interface MissionState {
  phase: MissionPhase;
  plan_summary?: string;
  validation_spec_paths: string[];
  assertion_count?: number;
  spec_dry_run_passed?: boolean;
  last_validation?: MissionValidationResult;
  decision_log: MissionDecisionLogEntry[];
  writer_task_id?: string;
  remote_validator_id?: string;
  retry_budget: { dev: number; validate: number };
}

export const DEFAULT_MISSION_RETRY_BUDGET = { dev: 3, validate: 3 };

export function createDefaultMissionState(phase: MissionPhase = 'plan'): MissionState {
  return {
    phase,
    validation_spec_paths: [],
    decision_log: [],
    retry_budget: { ...DEFAULT_MISSION_RETRY_BUDGET },
  };
}

export function parseMissionState(json: string | undefined | null): MissionState {
  if (!json?.trim()) return createDefaultMissionState();
  try {
    const parsed = JSON.parse(json) as Partial<MissionState>;
    return {
      ...createDefaultMissionState(parsed.phase ?? 'plan'),
      ...parsed,
      validation_spec_paths: Array.isArray(parsed.validation_spec_paths)
        ? parsed.validation_spec_paths.map(String)
        : [],
      decision_log: Array.isArray(parsed.decision_log) ? parsed.decision_log : [],
      retry_budget: {
        dev: parsed.retry_budget?.dev ?? DEFAULT_MISSION_RETRY_BUDGET.dev,
        validate: parsed.retry_budget?.validate ?? DEFAULT_MISSION_RETRY_BUDGET.validate,
      },
    };
  } catch {
    return createDefaultMissionState();
  }
}

export function serializeMissionState(state: MissionState): string {
  return JSON.stringify(state);
}

export function mergeMissionStatePatch(
  current: MissionState,
  patch: Partial<MissionState>,
): MissionState {
  return {
    ...current,
    ...patch,
    validation_spec_paths: patch.validation_spec_paths ?? current.validation_spec_paths,
    decision_log: patch.decision_log ?? current.decision_log,
    retry_budget: patch.retry_budget
      ? { ...current.retry_budget, ...patch.retry_budget }
      : current.retry_budget,
    last_validation: patch.last_validation ?? current.last_validation,
  };
}

export function isMissionsTemplate(run: Pick<OrchestrationRunRecord, 'template'>): boolean {
  return run.template === MISSIONS_TEMPLATE;
}

export function missionSpecGateSatisfied(state: MissionState): boolean {
  return (
    state.validation_spec_paths.length > 0
    && state.spec_dry_run_passed === true
    && (state.assertion_count ?? 0) > 0
  );
}

export function appendDecisionLog(
  state: MissionState,
  entry: Omit<MissionDecisionLogEntry, 'at'> & { at?: number },
): MissionState {
  return {
    ...state,
    decision_log: [
      ...state.decision_log,
      { ...entry, at: entry.at ?? Date.now() },
    ],
  };
}
