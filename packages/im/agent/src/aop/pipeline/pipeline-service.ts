/**
 * PipelineService — legacy cell.pipelineState（ADR 0024 D4，superseded by OrchestrationKernel）。
 *
 * Model-facing cell_* tools were removed. Retained for /collab reset and archived state reads.
 *
 * 不变量（legacy）：
 * - I3 阶段转移 = 代码门控（allowedNextStages）∩ Planner 决策
 * - I2 跨角色数据只经 ArtifactStore；Reviewer 仅读白名单 kind
 * - reviewCycles 超过 maxReviewCycles → 熔断进入 failed
 */
import {
  DEFAULT_MAX_REVIEW_CYCLES,
  type CollaborationScene,
  type PipelineArtifactKind,
  type PipelineStage,
  type PipelineState,
  type PipelineTodoItem,
} from '../../collaboration/types.js';
import { getCollaborationSceneService } from '../../collaboration/scene-service.js';
import { getCollaborationArtifactRepository } from '../../collaboration/collaboration-artifact-repository.js';
import {
  allowedNextStages,
  isRejectTransition,
  isTransitionAllowed,
  type PipelineProfile,
} from './pipeline-transitions.js';
import type { ArtifactStorePort, CellStatePort } from './ports.js';
import {
  archiveCurrentRun,
  buildFreshPipelineState,
  resolveRunIdRef,
  restorePipelineRun,
  summarizeRuns,
} from './pipeline-flow.js';

export interface PipelineServiceDeps {
  cells: CellStatePort;
  artifacts: ArtifactStorePort;
}

export interface EnsureStateOptions {
  userGoal?: string;
  runLabel?: string;
  profile?: PipelineProfile;
  maxReviewCycles?: number;
  /** create/reset：忽略未完成的 activeDelegations（默认拒绝） */
  force?: boolean;
}

export interface ManagePipelineOptions extends EnsureStateOptions {
  reason?: string;
  runId?: string;
  todo?: PipelineTodoItem[];
}

export interface AdvanceResult {
  ok: boolean;
  error?: string;
  state?: PipelineState;
}

/** Reviewer 入站记忆白名单（I2）：只能看 deliverable + citations，禁 evaluator blueprint。 */
export const REVIEWER_ARTIFACT_WHITELIST: PipelineArtifactKind[] = ['deliverable', 'citations', 'report'];

export class PipelineService {
  constructor(private readonly deps: PipelineServiceDeps) {}

  private async resolveCell(collaborationSceneId: string): Promise<CollaborationScene | undefined> {
    return (await this.deps.cells.getSceneFresh?.(collaborationSceneId)) ?? this.deps.cells.getScene(collaborationSceneId);
  }

  getState(cell: CollaborationScene): PipelineState | undefined {
    return cell.pipelineState;
  }

  async ensureState(cell: CollaborationScene, opts: EnsureStateOptions = {}): Promise<PipelineState> {
    if (cell.pipelineState) return cell.pipelineState;
    return this.initState(cell, opts);
  }

  async initState(cell: CollaborationScene, opts: EnsureStateOptions = {}): Promise<PipelineState> {
    const profile = opts.profile ?? 'full';
    const state = buildFreshPipelineState(profile, {
      userGoal: opts.userGoal,
      runLabel: opts.runLabel,
      maxReviewCycles: opts.maxReviewCycles ?? DEFAULT_MAX_REVIEW_CYCLES,
    });
    (state as PipelineState & { profile?: PipelineProfile }).profile = profile;
    await this.deps.cells.setPipelineState(cell.id, state);
    await this.syncActiveRunId(cell.id, state.runId);
    return state;
  }

  /** 新建流程：归档当前 run（若有），开启新 runId。 */
  async createRun(
    collaborationSceneId: string,
    opts: EnsureStateOptions = {},
  ): Promise<{ ok: true; state: PipelineState; previousRunId?: string } | { ok: false; error: string }> {
    const cell = await this.resolveCell(collaborationSceneId);
    if (!cell) return { ok: false, error: `cell ${collaborationSceneId} not found` };
    const pending = cell.pipelineState?.activeDelegations?.length ?? 0;
    if (pending > 0 && !opts.force) {
      return {
        ok: false,
        error: `${pending} active delegation(s) still in flight — wait for handback or use force=true on create/reset`,
      };
    }
    const profile = opts.profile ?? this.profileOf(cell.pipelineState ?? {} as PipelineState) ?? 'full';
    const previousRunId = cell.pipelineState?.runId;
    const runHistory = cell.pipelineState ? archiveCurrentRun(cell.pipelineState) : [];
    const state = buildFreshPipelineState(profile, {
      userGoal: opts.userGoal?.trim() || cell.pipelineState?.userGoal,
      runLabel: opts.runLabel?.trim(),
      maxReviewCycles: opts.maxReviewCycles
        ?? cell.pipelineState?.maxReviewCycles
        ?? DEFAULT_MAX_REVIEW_CYCLES,
      runHistory,
    });
    (state as PipelineState & { profile?: PipelineProfile }).profile = profile;
    await this.deps.cells.setPipelineState(collaborationSceneId, state);
    await this.syncActiveRunId(collaborationSceneId, state.runId);
    return { ok: true, state, previousRunId };
  }

  /** 重置流程：同 createRun，语义为「当前任务重来」。 */
  async resetRun(
    collaborationSceneId: string,
    opts: EnsureStateOptions & { reason?: string } = {},
  ): Promise<{ ok: true; state: PipelineState; previousRunId?: string } | { ok: false; error: string }> {
    return this.createRun(collaborationSceneId, opts);
  }

  /** 修改当前流程（不换 runId）。 */
  async updateRun(
    collaborationSceneId: string,
    patch: {
      userGoal?: string;
      runLabel?: string;
      todo?: PipelineTodoItem[];
      maxReviewCycles?: number;
    },
  ): Promise<{ ok: true; state: PipelineState } | { ok: false; error: string }> {
    const cell = await this.resolveCell(collaborationSceneId);
    if (!cell?.pipelineState) return { ok: false, error: 'pipeline not initialized' };
    const state = cell.pipelineState;
    const next: PipelineState = {
      ...state,
      userGoal: patch.userGoal?.trim() || state.userGoal,
      runLabel: patch.runLabel?.trim() || state.runLabel,
      todo: patch.todo ?? state.todo,
      maxReviewCycles: patch.maxReviewCycles ?? state.maxReviewCycles,
      updatedAt: Date.now(),
    };
    await this.deps.cells.setPipelineState(collaborationSceneId, next);
    if (patch.userGoal?.trim()) {
      await getCollaborationSceneService().setGoal(collaborationSceneId, patch.userGoal.trim());
    }
    return { ok: true, state: next };
  }

  /** 设置当前流程：切换到 runHistory 中的 run。 */
  async activateRun(
    collaborationSceneId: string,
    runRef: string,
    opts: { force?: boolean } = {},
  ): Promise<{ ok: true; state: PipelineState; previousRunId?: string } | { ok: false; error: string }> {
    const cell = await this.resolveCell(collaborationSceneId);
    if (!cell?.pipelineState) return { ok: false, error: 'pipeline not initialized' };
    const pending = cell.pipelineState.activeDelegations?.length ?? 0;
    if (pending > 0 && !opts.force) {
      return {
        ok: false,
        error: `${pending} active delegation(s) in flight — wait for handback or use force=true`,
      };
    }
    const state = cell.pipelineState;
    const targetRunId = resolveRunIdRef(runRef, state);
    if (!targetRunId) {
      return { ok: false, error: `run ${runRef} not found (legacy pipeline; use /collab status or orchestration_status)` };
    }
    if (targetRunId === state.runId) {
      return { ok: true, state, previousRunId: state.runId };
    }
    const profile = this.profileOf(state);
    const history = state.runHistory ?? [];
    const archive = history.find((h) => h.runId === targetRunId);
    if (!archive) {
      return { ok: false, error: `run ${runRef} not in history` };
    }
    const previousRunId = state.runId;
    const nextHistory = archiveCurrentRun(state).filter((h) => h.runId !== targetRunId);
    const next = restorePipelineRun(archive, profile, {
      maxReviewCycles: state.maxReviewCycles,
      runHistory: nextHistory,
    });
    (next as PipelineState & { profile?: PipelineProfile }).profile = profile;
    await this.deps.cells.setPipelineState(collaborationSceneId, next);
    await this.syncActiveRunId(collaborationSceneId, next.runId);
    return { ok: true, state: next, previousRunId };
  }

  listRuns(collaborationSceneId: string): { ok: true; runs: ReturnType<typeof summarizeRuns> } | { ok: false; error: string } {
    const cell = this.deps.cells.getScene(collaborationSceneId);
    if (!cell?.pipelineState) return { ok: false, error: 'pipeline not initialized' };
    return { ok: true, runs: summarizeRuns(cell.pipelineState) };
  }

  private async syncActiveRunId(collaborationSceneId: string, runId: string): Promise<void> {
    await this.deps.cells.setMissionRunId?.(collaborationSceneId, runId);
  }

  private profileOf(state: PipelineState): PipelineProfile {
    return (state as PipelineState & { profile?: PipelineProfile }).profile ?? 'full';
  }

  async advance(collaborationSceneId: string, to: PipelineStage, actor?: string): Promise<AdvanceResult> {
    const cell = await this.resolveCell(collaborationSceneId);
    if (!cell) return { ok: false, error: `cell ${collaborationSceneId} not found` };
    const state = cell.pipelineState;
    if (!state) return { ok: false, error: 'pipeline not initialized' };
    if (state.activeDelegations?.length) {
      return {
        ok: false,
        error: `cannot advance while ${state.activeDelegations.length} delegation(s) active — wait for handback`,
      };
    }
    const profile = this.profileOf(state);

    if (!isTransitionAllowed(state.stage, to, profile)) {
      return {
        ok: false,
        error: `illegal transition ${state.stage} → ${to} (allowed: ${allowedNextStages(state.stage, profile).join(', ')})`,
      };
    }

    let reviewCycles = state.reviewCycles;
    let nextStage = to;
    if (isRejectTransition(state.stage, to)) {
      reviewCycles += 1;
      if (reviewCycles >= state.maxReviewCycles) {
        // 熔断：达到上限，进入 failed，仅 Planner 可向人类汇报
        nextStage = 'failed';
      }
    }

    const next: PipelineState = {
      ...state,
      stage: nextStage,
      reviewCycles,
      allowedNextStages: allowedNextStages(nextStage, profile),
      updatedAt: Date.now(),
    };
    (next as PipelineState & { profile?: PipelineProfile }).profile = profile;
    await this.deps.cells.setPipelineState(collaborationSceneId, next);
    return { ok: true, state: next };
  }

  async submitArtifact(input: {
    collaborationSceneId: string;
    runId: string;
    stage: PipelineStage;
    kind: PipelineArtifactKind;
    payload: Record<string, unknown>;
    createdByEndpoint?: string;
  }) {
    return this.deps.artifacts.submit(input);
  }

  async readArtifacts(collaborationSceneId: string, runId: string, kinds?: PipelineArtifactKind[]) {
    return this.deps.artifacts.listByRun(collaborationSceneId, runId, kinds);
  }

  /**
   * Reviewer 记忆切片（I2）：只暴露 userGoal + Executor deliverable + Researcher citations，
   * 永不暴露 Evaluator blueprint（CoT 隔离）。
   */
  async reviewerContextSlice(collaborationSceneId: string, runId: string): Promise<{
    userGoal?: string;
    deliverable?: Record<string, unknown>;
    citations: Array<Record<string, unknown>>;
  }> {
    const cell = this.deps.cells.getScene(collaborationSceneId);
    const deliverable = await this.deps.artifacts.latest(collaborationSceneId, runId, 'deliverable');
    const citationArtifacts = await this.deps.artifacts.listByRun(collaborationSceneId, runId, ['citations', 'report']);
    return {
      userGoal: cell?.pipelineState?.userGoal,
      deliverable: deliverable?.payload,
      citations: citationArtifacts.map((a) => a.payload),
    };
  }
}

let globalPipelineService: PipelineService | null = null;

export function getPipelineService(): PipelineService {
  if (!globalPipelineService) {
    globalPipelineService = new PipelineService({
      cells: {
        getScene: (id) => getCollaborationSceneService().getScene(id),
        getSceneFresh: async (id) => (await getCollaborationSceneService().getSceneFresh(id)) ?? undefined,
        setPipelineState: (id, state) => getCollaborationSceneService().setPipelineState(id, state),
        setMissionRunId: (id, runId) => getCollaborationSceneService().setMissionRunId(id, runId),
      },
      artifacts: getCollaborationArtifactRepository(),
    });
  }
  return globalPipelineService;
}

export function setPipelineService(svc: PipelineService | null): void {
  globalPipelineService = svc;
}
