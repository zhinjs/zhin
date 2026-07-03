/**
 * Pipeline 工具（ADR 0024 D2）：阶段产物提交/读取、阶段推进、状态查询。
 *
 * - cell_submit_artifact：当前角色提交本阶段产物
 * - cell_read_artifact：读取 run 内产物（reviewer 受白名单约束）
 * - cell_advance_stage：仅 planner 可推进阶段（代码门控转移表）
 * - cell_pipeline_status：读取 stage / reviewCycles / allowedNextStages
 */
import type { Message, Tool, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { BuiltinBaseTool } from '../../builtin/builtin-base-tool.js';
import { getCollaborationSceneService } from '../../collaboration/scene-service.js';
import { resolveCellForScene, findCellMemberByEndpoint } from '../../collaboration/collaboration-config.js';
import { resolveArtifactRunId } from '../../collaboration/resolve-agent-session-key.js';
import { resolveArtifactSubmitRunId, findActiveDelegation } from '../../collaboration/delegation-state.js';
import { readCollaborationTurnSnapshot } from '../../collaboration/collaboration-turn-snapshot.js';
import {
  isPipelineRole,
  type CollaborationScene,
  type PipelineArtifactKind,
  type PipelineStage,
} from '../../collaboration/types.js';
import { getPipelineService, REVIEWER_ARTIFACT_WHITELIST } from './pipeline-service.js';
import { normalizeTodoPatch } from './pipeline-flow.js';
import type { PipelineManageAction } from '../../collaboration/types.js';
import {
  formatArtifactFeedSummary,
  formatArtifactSubmitFeedHeadline,
  formatStageFeedText,
  publishCollaborationGroupFeed,
  resolveActorPipelineRole,
} from '../../collaboration/group-feed.js';

export const PIPELINE_TOOL_NAMES = [
  'cell_submit_artifact',
  'cell_read_artifact',
  'cell_advance_stage',
  'cell_pipeline_status',
  'cell_manage_pipeline',
  'cell_reset_pipeline',
] as const;

const ARTIFACT_KINDS: PipelineArtifactKind[] = ['report', 'blueprint', 'deliverable', 'review', 'citations'];

function resolveCell(message: Message): CollaborationScene | undefined {
  const adapter = String(message.$adapter || '');
  const sceneId = message.$channel?.id;
  if (!sceneId) return undefined;
  return resolveCellForScene(adapter, sceneId);
}

const SUBMIT_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', description: `产物类型：${ARTIFACT_KINDS.join(' | ')}` },
    payload: { type: 'object', description: '结构化产物内容（JSON）' },
  },
  required: ['kind', 'payload'],
};

const READ_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string', description: '可选：指定 runId 或前缀（默认当前 active run）' },
    kinds: { type: 'array', items: { type: 'string' }, description: '可选：仅读指定 kind' },
  },
};

const ADVANCE_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    toStage: { type: 'string', description: '目标阶段（须在 allowedNextStages 内）' },
  },
  required: ['toStage'],
};

const STATUS_PARAMS: ToolParametersSchema = { type: 'object', properties: {} };

const RESET_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    userGoal: { type: 'string', description: '新一轮任务目标（可选，覆盖 pipeline userGoal）' },
    reason: { type: 'string', description: '重置原因（可选，写入群 feed）' },
  },
};

const MANAGE_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'create=新建流程 | reset=重置流程 | update=修改当前流程 | activate=设置当前流程 | list=列出流程',
    },
    userGoal: { type: 'string', description: '流程目标（create/reset/update）' },
    label: { type: 'string', description: '流程名称（create/update）' },
    runId: { type: 'string', description: '目标 runId 或前缀（activate）' },
    todo: {
      type: 'array',
      description: 'Planner todo 列表 [{id?, text, done?}]（update）',
      items: { type: 'object' },
    },
    maxReviewCycles: { type: 'number', description: 'Reviewer 熔断上限（update）' },
    reason: { type: 'string', description: '原因说明（create/reset/activate，写入群 feed）' },
    force: { type: 'boolean', description: 'create/reset：true 时强制新建（忽略 in-flight 委派）' },
  },
  required: ['action'],
};

function assertPlanner(cell: CollaborationScene, ctx: Message): { ok: true } | { ok: false; error: string } {
  const member = findCellMemberByEndpoint(cell, String(ctx.$endpoint));
  if (member?.pipelineRole && member.pipelineRole !== 'planner') {
    return { ok: false, error: '仅 Planner 可管理 pipeline 流程' };
  }
  return { ok: true };
}

function parseManageAction(raw: unknown): PipelineManageAction | undefined {
  const action = String(raw ?? '').trim().toLowerCase();
  if (action === 'create' || action === 'reset' || action === 'update' || action === 'activate' || action === 'list') {
    return action;
  }
  return undefined;
}

class CellSubmitArtifactTool extends BuiltinBaseTool {
  readonly name = 'cell_submit_artifact';
  readonly description = '提交当前阶段的结构化产物（report/blueprint/deliverable/review/citations）。';
  readonly parameters = SUBMIT_PARAMS;

  constructor(private readonly ctx: Message) {
    super();
    this.tags.push('collaboration', 'pipeline');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = getCollaborationSceneService();
    let cell = resolveCell(this.ctx);
    if (!cell) return { ok: false, error: '无法解析协作单元' };
    const fresh = await svc.getSceneFresh(cell.id);
    if (fresh) cell = fresh;
    const state = cell.pipelineState;
    if (!state) return { ok: false, error: 'pipeline 未初始化' };
    const endpointId = String(this.ctx.$endpoint);
    const delegation = findActiveDelegation(cell, endpointId);
    if (delegation && !delegation.requireArtifact) {
      return {
        ok: false,
        error: '当前委派未要求结构化产物；请直接回复任务结果并 handback @Planner',
      };
    }
    const snap = readCollaborationTurnSnapshot(this.ctx);
    const submitRun = resolveArtifactSubmitRunId(cell, endpointId, {
      turnDelegationRunId: snap?.delegationRunId,
    });
    if (!submitRun.ok) return { ok: false, error: submitRun.error };
    const kind = String(args.kind ?? '') as PipelineArtifactKind;
    if (!ARTIFACT_KINDS.includes(kind)) return { ok: false, error: `非法 kind: ${kind}` };
    const payload = (args.payload && typeof args.payload === 'object' ? args.payload : {}) as Record<string, unknown>;
    const member = findCellMemberByEndpoint(cell, endpointId);
    const stage: PipelineStage = isPipelineRole(member?.pipelineRole) ? member!.pipelineRole : state.stage;
    const artifact = await getPipelineService().submitArtifact({
      collaborationSceneId: cell.id,
      runId: submitRun.runId,
      stage,
      kind,
      payload,
      createdByEndpoint: endpointId,
    });
    const role = member?.pipelineRole && isPipelineRole(member.pipelineRole) ? member.pipelineRole : undefined;
    await publishCollaborationGroupFeed({
      message: this.ctx,
      role,
      emoji: '📦',
      headline: formatArtifactSubmitFeedHeadline(kind),
      detail: formatArtifactFeedSummary(kind, payload),
    });
    return {
      ok: true,
      artifactId: artifact.id,
      kind,
      runId: submitRun.runId,
      activeRunId: state.runId,
      submitReason: submitRun.reason,
    };
  }
}

class CellReadArtifactTool extends BuiltinBaseTool {
  readonly name = 'cell_read_artifact';
  readonly description =
    '读取 pipeline 阶段产物（默认当前 run；可传 runId 读历史 run）。Reviewer 仅可读白名单。';
  readonly parameters = READ_PARAMS;

  constructor(private readonly ctx: Message) {
    super();
    this.tags.push('collaboration', 'pipeline');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const cell = resolveCell(this.ctx);
    if (!cell) return { ok: false, error: '无法解析协作单元' };
    const state = cell.pipelineState;
    if (!state) return { ok: false, error: 'pipeline 未初始化' };
    const runRef = typeof args.runId === 'string' ? args.runId : undefined;
    const runResolved = resolveArtifactRunId(runRef, cell);
    if (!runResolved.ok) return { ok: false, error: runResolved.error };
    const runId = runResolved.runId;
    const member = findCellMemberByEndpoint(cell, String(this.ctx.$endpoint));
    const requested = Array.isArray(args.kinds)
      ? (args.kinds.filter((k): k is string => typeof k === 'string') as PipelineArtifactKind[])
      : undefined;

    // I2：reviewer 记忆切片，强制白名单
    if (member?.pipelineRole === 'reviewer') {
      const slice = await getPipelineService().reviewerContextSlice(cell.id, runId);
      return { ok: true, runId, activeRunId: state.runId, reviewerSlice: slice };
    }

    const kinds = requested?.length ? requested : undefined;
    const artifacts = await getPipelineService().readArtifacts(cell.id, runId, kinds);
    return { ok: true, runId, activeRunId: state.runId, artifacts };
  }
}

class CellAdvanceStageTool extends BuiltinBaseTool {
  readonly name = 'cell_advance_stage';
  readonly description = '推进流水线到下一阶段（仅 Planner 可用；受转移表门控）。';
  readonly parameters = ADVANCE_PARAMS;

  constructor(private readonly ctx: Message) {
    super();
    this.tags.push('collaboration', 'pipeline', 'orchestrator');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const cell = resolveCell(this.ctx);
    if (!cell) return { ok: false, error: '无法解析协作单元' };
    const member = findCellMemberByEndpoint(cell, String(this.ctx.$endpoint));
    if (member?.pipelineRole && member.pipelineRole !== 'planner') {
      return { ok: false, error: '仅 Planner 可推进阶段' };
    }
    const toStage = String(args.toStage ?? '') as PipelineStage;
    const fromStage = cell.pipelineState?.stage;
    const result = await getPipelineService().advance(cell.id, toStage, String(this.ctx.$endpoint));
    if (!result.ok) return { ok: false, error: result.error };
    if (fromStage && result.state?.stage) {
      await publishCollaborationGroupFeed({
        message: this.ctx,
        role: 'planner',
        emoji: '⏭️',
        headline: formatStageFeedText(fromStage, result.state.stage),
      });
    }
    return {
      ok: true,
      stage: result.state?.stage,
      reviewCycles: result.state?.reviewCycles,
      allowedNextStages: result.state?.allowedNextStages,
    };
  }
}

class CellPipelineStatusTool extends BuiltinBaseTool {
  readonly name = 'cell_pipeline_status';
  readonly description =
    '读取 pipeline 进度：stage、delegations、runs 列表（含历史 run，便于 reset 后找回产物）。';
  readonly parameters = STATUS_PARAMS;

  constructor(private readonly ctx: Message) {
    super();
    this.tags.push('collaboration', 'pipeline');
  }

  async run(): Promise<ToolResult> {
    const cell = resolveCell(this.ctx);
    if (!cell) return { ok: false, error: '无法解析协作单元' };
    const listed = cell.pipelineState
      ? getPipelineService().listRuns(cell.id)
      : { ok: false as const, error: 'pipeline not initialized' };
    return {
      ok: true,
      collaborationSceneId: cell.id,
      goal: cell.goal,
      pipelineState: cell.pipelineState ?? null,
      runs: listed.ok ? listed.runs : [],
      members: cell.members.map((m) => ({
        endpointId: m.endpointId,
        primary: m.primary,
        pipelineRole: m.pipelineRole,
      })),
    };
  }
}

class CellResetPipelineTool extends BuiltinBaseTool {
  readonly name = 'cell_reset_pipeline';
  readonly description =
    '重置 pipeline 流程（等同 cell_manage_pipeline action=reset）。仅 Planner。';
  readonly parameters = RESET_PARAMS;

  constructor(private readonly ctx: Message) {
    super();
    this.tags.push('collaboration', 'pipeline', 'orchestrator');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    return new CellManagePipelineTool(this.ctx).run({ ...args, action: 'reset' });
  }
}

class CellManagePipelineTool extends BuiltinBaseTool {
  readonly name = 'cell_manage_pipeline';
  readonly description =
    'Planner 流程 SSOT：create 新建 | reset 重置 | update 修改当前 | activate 切换当前 run | list 列出。';
  readonly parameters = MANAGE_PARAMS;

  constructor(private readonly ctx: Message) {
    super();
    this.tags.push('collaboration', 'pipeline', 'orchestrator');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const cell = resolveCell(this.ctx);
    if (!cell) return { ok: false, error: '无法解析协作单元' };
    const action = parseManageAction(args.action);
    if (!action) {
      return { ok: false, error: 'action 须为 create | reset | update | activate | list' };
    }
    if (action !== 'list') {
      const gate = assertPlanner(cell, this.ctx);
      if (!gate.ok) return gate;
    }

    const svc = getPipelineService();
    const userGoal = typeof args.userGoal === 'string' ? args.userGoal.trim() : undefined;
    const label = typeof args.label === 'string' ? args.label.trim() : undefined;
    const reason = typeof args.reason === 'string' ? args.reason.trim() : undefined;
    const runRef = typeof args.runId === 'string' ? args.runId.trim() : undefined;
    const todo = normalizeTodoPatch(args.todo);
    const maxReviewCycles = typeof args.maxReviewCycles === 'number' ? args.maxReviewCycles : undefined;
    const force = args.force === true;

    if (action === 'list') {
      const listed = svc.listRuns(cell.id);
      if (!listed.ok) return { ok: false, error: listed.error };
      return {
        ok: true,
        collaborationSceneId: cell.id,
        activeRunId: cell.pipelineState?.runId,
        runs: listed.runs,
      };
    }

    if (action === 'update') {
      if (!cell.pipelineState) {
        const created = await svc.createRun(cell.id, { userGoal, runLabel: label });
        if (!created.ok) return { ok: false, error: created.error };
        return { ok: true, action, ...created.state, runId: created.state.runId, note: 'auto-created pipeline' };
      }
      const updated = await svc.updateRun(cell.id, {
        userGoal,
        runLabel: label,
        todo,
        maxReviewCycles,
      });
      if (!updated.ok) return { ok: false, error: updated.error };
      if (userGoal || label) {
        await publishCollaborationGroupFeed({
          message: this.ctx,
          role: 'planner',
          emoji: '✏️',
          headline: '更新了协作流程',
          detail: reason || userGoal || label || undefined,
        });
      }
      return { ok: true, action, runId: updated.state.runId, pipelineState: updated.state };
    }

    if (action === 'activate') {
      if (!runRef) return { ok: false, error: 'activate 需要 runId（可用 action=list 查看）' };
      const activated = await svc.activateRun(cell.id, runRef, { force });
      if (!activated.ok) return { ok: false, error: activated.error };
      await publishCollaborationGroupFeed({
        message: this.ctx,
        role: 'planner',
        emoji: '🔀',
        headline: '切换了当前流程',
        detail: reason || activated.state.runId,
      });
      return {
        ok: true,
        action,
        previousRunId: activated.previousRunId,
        runId: activated.state.runId,
        stage: activated.state.stage,
        userGoal: activated.state.userGoal,
      };
    }

    const isReset = action === 'reset';
    let state;
    let previousRunId: string | undefined;
    if (cell.pipelineState) {
      const started = await svc.createRun(cell.id, { userGoal, runLabel: label, force });
      if (!started.ok) return { ok: false, error: started.error };
      state = started.state;
      previousRunId = started.previousRunId;
    } else {
      state = await svc.initState(cell, { userGoal, runLabel: label });
    }

    if (userGoal) {
      await getCollaborationSceneService().setGoal(cell.id, userGoal);
    }

    await publishCollaborationGroupFeed({
      message: this.ctx,
      role: 'planner',
      emoji: isReset ? '🔄' : '🆕',
      headline: isReset ? '已重置协作流程' : '已开启新协作流程',
      detail: reason || label || userGoal || state.runId,
    });

    return {
      ok: true,
      action,
      previousRunId,
      runId: state.runId,
      label: state.runLabel,
      stage: state.stage,
      userGoal: state.userGoal,
      allowedNextStages: state.allowedNextStages,
      runCount: (state.runHistory?.length ?? 0) + 1,
    };
  }
}

export function createPipelineTools(commMessage: Message): Tool[] {
  return [
    new CellSubmitArtifactTool(commMessage).toTool(),
    new CellReadArtifactTool(commMessage).toTool(),
    new CellAdvanceStageTool(commMessage).toTool(),
    new CellPipelineStatusTool(commMessage).toTool(),
    new CellManagePipelineTool(commMessage).toTool(),
    new CellResetPipelineTool(commMessage).toTool(),
  ];
}

export { REVIEWER_ARTIFACT_WHITELIST };
