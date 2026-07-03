/**
 * Collaboration builtin tools — cell goal, mission status, group delegate.
 */

import type { Message, Tool, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { BuiltinBaseTool } from '../builtin/builtin-base-tool.js';
import { getCollaborationCellService } from './cell-service.js';
import { resolveCellContextKeyFromMessage } from './cell-context.js';
import { resolveCellForScene, findCellMemberByEndpoint, resolvePeerEndpointInCell } from './collaboration-config.js';
import {
  coerceGroupDelegateArgs,
  sendCollaborationMentionPayload,
} from './collaboration-outbound.js';
import {
  publishCollaborationGroupFeed,
  resolveActorPipelineRole,
} from './group-feed.js';
import { isPipelineRole } from './types.js';
import { createPipelineTools, PIPELINE_TOOL_NAMES } from '../aop/pipeline/pipeline-tools.js';
import { detectCeremonyOrchestrationIntent } from './collaboration-context.js';
import {
  resolveTargetRole,
  upsertActiveDelegation,
  removeActiveDelegationForEndpoint,
  defaultArtifactKindsForRole,
  replaceCeremonyDelegation,
} from './delegation-state.js';

export const COLLABORATION_TOOL_NAMES = [
  'cell_set_goal',
  'cell_mission_status',
] as const;

const CELL_SET_GOAL_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: '群协作目标文本' },
    cellId: { type: 'string', description: '可选协作单元 ID' },
  },
  required: ['goal'],
};

const CELL_MISSION_STATUS_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    cellId: { type: 'string', description: '可选协作单元 ID' },
  },
};

const GROUP_DELEGATE_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description:
        '可选 JSON 字符串；也可改用下方扁平字段（mentions/text/requireArtifact/mode）',
    },
    mentions: {
      type: 'array',
      items: { type: 'string' },
      description: '被委派 peer：pipelineRole / primary / endpointId',
    },
    text: { type: 'string', description: '委派正文（群内 @ 后可见）' },
    requireArtifact: {
      type: 'boolean',
      description: '是否要求对方 cell_submit_artifact 后才能 handback',
    },
    artifactKinds: {
      type: 'array',
      items: { type: 'string' },
      description: 'requireArtifact=true 时必填，如 report、citations',
    },
    mode: {
      type: 'string',
      enum: ['pipeline', 'ceremony'],
      description: 'pipeline=当前 stage 成员；ceremony=任意单 peer',
    },
  },
};

class CellSetGoalTool extends BuiltinBaseTool {
  readonly name = 'cell_set_goal';
  readonly description = '设置当前协作单元（群）的轻量目标。';
  readonly parameters = CELL_SET_GOAL_PARAMS;

  constructor(private readonly sessionContext: Message) {
    super();
    this.tags.push('collaboration');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const goal = String(args.goal ?? '');
    const svc = getCollaborationCellService();
    let cellId = typeof args.cellId === 'string' ? args.cellId : undefined;
    if (!cellId) {
      const adapter = String(this.sessionContext.$adapter || '');
      const sceneId = this.sessionContext.$channel?.id;
      if (sceneId) {
        const cell = resolveCellForScene(adapter, sceneId);
        cellId = cell?.id;
      }
    }
    if (!cellId) return { ok: false, error: '无法解析协作单元' };
    const result = await svc.setGoal(cellId, goal);
    if (!result.ok) return { ok: false, error: result.error };
    const role = resolveActorPipelineRole(this.sessionContext);
    await publishCollaborationGroupFeed({
      message: this.sessionContext,
      role,
      emoji: '🎯',
      headline: '已更新协作目标',
      detail: goal,
    });
    return { ok: true, cellId, goal };
  }
}

class CellMissionStatusTool extends BuiltinBaseTool {
  readonly name = 'cell_mission_status';
  readonly description = '读取当前协作单元的 goal 与 missionRunId。';
  readonly parameters = CELL_MISSION_STATUS_PARAMS;

  constructor(private readonly sessionContext: Message) {
    super();
    this.tags.push('collaboration');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = getCollaborationCellService();
    let cellId = typeof args.cellId === 'string' ? args.cellId : undefined;
    if (!cellId) {
      const adapter = String(this.sessionContext.$adapter || '');
      const sceneId = this.sessionContext.$channel?.id;
      if (sceneId) {
        const cell = resolveCellForScene(adapter, sceneId);
        cellId = cell?.id;
      }
    }
    if (!cellId) return { ok: false, error: '无法解析协作单元' };
    const status = svc.getMissionStatus(cellId);
    if (!status) return { ok: false, error: `cell ${cellId} not found` };
    const cellKey = resolveCellContextKeyFromMessage(this.sessionContext);
    const cell = svc.getCell(cellId);
    const members = cell?.members.map((m) => ({
      endpointId: m.endpointId,
      primary: m.primary,
      role: m.role,
      pipelineRole: m.pipelineRole,
    }));
    return { ok: true, cellId, cellContextKey: cellKey, members, ...status };
  }
}

export class GroupDelegateTool extends BuiltinBaseTool {
  readonly name = 'group_delegate';
  readonly description =
    '正式委派：message 为 JSON（requireArtifact 必填；requireArtifact=true 时 artifactKinds 必填；mode=pipeline|ceremony）。';
  readonly parameters = GROUP_DELEGATE_PARAMS;

  constructor(private readonly sessionContext: Message) {
    super();
    this.tags.push('collaboration', 'orchestrator');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const payload = coerceGroupDelegateArgs(args);
    if (!payload) {
      return {
        ok: false,
        error:
          '委派参数无效：需 message=JSON 或扁平字段 mentions+text+requireArtifact（requireArtifact=true 时还要 artifactKinds）',
      };
    }

    const sceneId = this.sessionContext.$channel?.id;
    if (!sceneId) return { ok: false, error: '仅支持群/频道内委派' };

    const svc = getCollaborationCellService();
    const cell = resolveCellForScene(
      String(this.sessionContext.$adapter || ''),
      sceneId,
    );
    if (!cell) return { ok: false, error: '无法解析协作单元' };
    const fresh = (await svc.getCellFresh(cell.id)) ?? cell;

    const mode = payload.mode ?? 'pipeline';

    const endpointIds: string[] = [];
    for (const ref of payload.mentions ?? []) {
      const peer = resolvePeerEndpointInCell(fresh, ref);
      if (peer) endpointIds.push(peer);
    }

    let requireArtifact = payload.requireArtifact;
    let artifactKinds = payload.artifactKinds;
    let effectiveMode = mode;
    if (requireArtifact === false) {
      effectiveMode = 'ceremony';
    } else if (!payload.mode && detectCeremonyOrchestrationIntent(fresh.goal)) {
      effectiveMode = 'ceremony';
      requireArtifact = false;
    }

    if (effectiveMode === 'ceremony' && endpointIds.length > 1) {
      return {
        ok: false,
        error: 'ceremony 每次只委派一位成员，请等 handback 后再委派下一位',
      };
    }
    if (effectiveMode === 'pipeline' && fresh.pipelineState && payload.mentions?.length) {
      const currentStage = fresh.pipelineState.stage;
      for (const ref of payload.mentions) {
        const peerEndpoint = resolvePeerEndpointInCell(fresh, ref);
        const targetRole = peerEndpoint
          ? fresh.members.find((m) => m.endpointId === peerEndpoint)?.pipelineRole
          : undefined;
        if (targetRole && isPipelineRole(targetRole) && targetRole !== currentStage) {
          return {
            ok: false,
            error: `pipeline 模式须委派当前 stage（${currentStage}），不能委派 ${targetRole}`,
          };
        }
      }
    }

    if (effectiveMode === 'pipeline' && endpointIds.length === 1 && requireArtifact === true) {
      const role = resolveTargetRole(fresh, endpointIds[0]!);
      const defaults = role ? defaultArtifactKindsForRole(role) : [];
      if (defaults.length && !artifactKinds?.length) {
        artifactKinds = defaults;
      }
    }

    if (endpointIds.length && fresh.pipelineState) {
      const runId = fresh.pipelineState.runId;
      const patchResult = await svc.patchPipelineState(fresh.id, (prev) => {
        if (!prev) return undefined;
        let delegations = prev.activeDelegations ?? [];
        for (const endpointId of endpointIds) {
          const targetRole = resolveTargetRole(fresh, endpointId);
          if (!targetRole) continue;
          const entry = {
            targetEndpointId: endpointId,
            targetRole,
            runId,
            requireArtifact,
            artifactKinds,
            mode: effectiveMode,
            delegateText: payload.text,
            updatedAt: Date.now(),
          };
          delegations = effectiveMode === 'ceremony'
            ? replaceCeremonyDelegation(delegations, entry)
            : upsertActiveDelegation(delegations, entry);
        }
        return {
          ...prev,
          activeDelegations: delegations,
          pendingDelegateTarget: undefined,
          updatedAt: Date.now(),
        };
      });
      if (!patchResult.ok) {
        return { ok: false, error: patchResult.error ?? '委派状态写入失败' };
      }
    }

    const sent = await sendCollaborationMentionPayload(this.sessionContext, payload);
    if (!sent.ok) {
      if (endpointIds.length && fresh.pipelineState) {
        await svc.patchPipelineState(fresh.id, (prev) => {
          if (!prev) return undefined;
          let delegations = prev.activeDelegations ?? [];
          for (const endpointId of endpointIds) {
            delegations = removeActiveDelegationForEndpoint(delegations, endpointId, fresh.pipelineState!.runId);
          }
          return {
            ...prev,
            activeDelegations: delegations.length ? delegations : undefined,
            updatedAt: Date.now(),
          };
        });
      }
      return { ok: false, error: sent.error };
    }

    return {
      ok: true,
      peerEndpoints: sent.endpointIds ?? endpointIds,
      sceneId,
      mode: 'im_mention',
      requireArtifact,
      artifactKinds,
    };
  }
}

export function createCollaborationTools(commMessage: Message): Tool[] {
  return [
    new CellSetGoalTool(commMessage).toTool(),
    new CellMissionStatusTool(commMessage).toTool(),
    new GroupDelegateTool(commMessage).toTool(),
    ...createPipelineTools(commMessage),
  ];
}
