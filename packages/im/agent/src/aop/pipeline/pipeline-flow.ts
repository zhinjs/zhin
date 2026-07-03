/**
 * Pipeline 流程生命周期：归档、切换、列表（Planner SSOT）。
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_MAX_REVIEW_CYCLES,
  type PipelineRunArchive,
  PipelineStage,
  PipelineState,
  PipelineTodoItem,
} from '../../collaboration/types.js';
import { allowedNextStages, type PipelineProfile } from './pipeline-transitions.js';

export function snapshotPipelineRun(state: PipelineState, archivedAt = Date.now()): PipelineRunArchive {
  return {
    runId: state.runId,
    label: state.runLabel,
    userGoal: state.userGoal,
    stage: state.stage,
    reviewCycles: state.reviewCycles,
    todo: [...state.todo],
    activeDelegationsAtArchive: state.activeDelegations?.map((d) => ({
      ...d,
      runId: d.runId || state.runId,
    })),
    createdAt: state.runCreatedAt ?? state.updatedAt,
    archivedAt,
  };
}

export function archiveCurrentRun(state: PipelineState): PipelineRunArchive[] {
  const history = state.runHistory ?? [];
  if (history.some((h) => h.runId === state.runId)) return history;
  return [...history, snapshotPipelineRun(state)];
}

export function resolveRunIdRef(ref: string, state: PipelineState): string | undefined {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  if (state.runId === trimmed || state.runId.startsWith(trimmed)) return state.runId;
  const fromHistory = (state.runHistory ?? []).find(
    (h) => h.runId === trimmed || h.runId.startsWith(trimmed),
  );
  return fromHistory?.runId;
}

export function buildFreshPipelineState(
  profile: PipelineProfile,
  opts: {
    userGoal?: string;
    runLabel?: string;
    maxReviewCycles?: number;
    runHistory?: PipelineRunArchive[];
  } = {},
): PipelineState {
  const stage: PipelineStage = 'planner';
  const now = Date.now();
  return {
    runId: randomUUID(),
    runLabel: opts.runLabel,
    runCreatedAt: now,
    stage,
    reviewCycles: 0,
    maxReviewCycles: opts.maxReviewCycles ?? DEFAULT_MAX_REVIEW_CYCLES,
    allowedNextStages: allowedNextStages(stage, profile),
    todo: [],
    userGoal: opts.userGoal,
    runHistory: opts.runHistory,
    activeDelegations: undefined,
    pendingDelegateTarget: undefined,
    taskBrief: undefined,
    updatedAt: now,
  };
}

export function restorePipelineRun(
  archive: PipelineRunArchive,
  profile: PipelineProfile,
  opts: {
    maxReviewCycles: number;
    runHistory: PipelineRunArchive[];
  },
): PipelineState {
  const now = Date.now();
  return {
    runId: archive.runId,
    runLabel: archive.label,
    runCreatedAt: archive.createdAt,
    stage: archive.stage,
    reviewCycles: archive.reviewCycles,
    maxReviewCycles: opts.maxReviewCycles,
    allowedNextStages: allowedNextStages(archive.stage, profile),
    todo: [...archive.todo],
    userGoal: archive.userGoal,
    runHistory: opts.runHistory,
    activeDelegations: undefined,
    pendingDelegateTarget: undefined,
    taskBrief: undefined,
    updatedAt: now,
  };
}

export function summarizeRuns(state: PipelineState): Array<{
  runId: string;
  label?: string;
  userGoal?: string;
  stage: PipelineStage;
  active: boolean;
  archivedAt?: number;
}> {
  const current = {
    runId: state.runId,
    label: state.runLabel,
    userGoal: state.userGoal,
    stage: state.stage,
    active: true,
  };
  const archived = (state.runHistory ?? []).map((h) => ({
    runId: h.runId,
    label: h.label,
    userGoal: h.userGoal,
    stage: h.stage,
    active: false,
    archivedAt: h.archivedAt,
  }));
  return [current, ...archived];
}

export function normalizeTodoPatch(raw: unknown): PipelineTodoItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: PipelineTodoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!text) continue;
    const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : randomUUID();
    items.push({
      id,
      text,
      done: rec.done === true,
    });
  }
  return items;
}
