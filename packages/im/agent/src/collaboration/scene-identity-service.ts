/**
 * SceneIdentityService — 逻辑 Cell 解析 + scene_aliases 管理。
 *
 * 同一物理协作群 = 一个逻辑 Cell + 多 adapter 下的 scene/user 视角表。
 * 入站消息通过 `resolveLogicalCell(adapter, sceneId)` 得到逻辑 Cell。
 */

import type { CollaborationCell } from './types.js';
import { getCollaborationCellService } from './cell-service.js';
import type {
  CollaborationCellSceneRow,
  CollaborationInitSessionRow,
  CollaborationInitObservationRow,
  CollaborationCellMemberChannelRow,
} from './collaboration-db-model.js';
import { isPipelineRole } from './types.js';

export interface SceneAliasRecord {
  logicalCellId: string;
  adapter: string;
  sceneId: string;
}

export interface InitSessionRecord {
  id: string;
  logicalCellId: string;
  plannerEndpointId: string;
  plannerAdapter: string;
  plannerSceneId: string;
  status: string;
  wizardStep: string;
  createdAt: number;
  updatedAt: number;
}

export interface InitObservationRecord {
  sessionId: string;
  observerEndpointId: string;
  observerAdapter: string;
  observerSceneId: string;
  atTargetPlatformId: string;
  wizardStep: string;
  observedAt: number;
}

export interface MemberChannelRecord {
  logicalCellId: string;
  endpointId: string;
  pipelineRole: string;
  adapter: string;
  sceneId: string;
  botId: string;
}

/** 协作群全景图输出格式。 */
export interface GroupViewAgent {
  name: string;
  channels: Array<{ adapter: string; scene_id: string; bot_id: string }>;
}

export interface GroupView {
  group_id: string;
  group_name: string;
  agents: GroupViewAgent[];
}

type DbModel = {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
  update(data: Record<string, unknown>): {
    where(condition: Record<string, unknown>): Promise<unknown>;
  };
  delete?(): {
    where(condition: Record<string, unknown>): Promise<unknown>;
  };
};

function rowToSceneAlias(row: Record<string, unknown>): SceneAliasRecord {
  return {
    logicalCellId: String(row.logical_cell_id ?? ''),
    adapter: String(row.adapter ?? ''),
    sceneId: String(row.scene_id ?? ''),
  };
}

function rowToInitSession(row: Record<string, unknown>): InitSessionRecord {
  return {
    id: String(row.id ?? ''),
    logicalCellId: String(row.logical_cell_id ?? ''),
    plannerEndpointId: String(row.planner_endpoint_id ?? ''),
    plannerAdapter: String(row.planner_adapter ?? ''),
    plannerSceneId: String(row.planner_scene_id ?? ''),
    status: String(row.status ?? ''),
    wizardStep: String(row.wizard_step ?? ''),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function rowToObservation(row: Record<string, unknown>): InitObservationRecord {
  return {
    sessionId: String(row.session_id ?? ''),
    observerEndpointId: String(row.observer_endpoint_id ?? ''),
    observerAdapter: String(row.observer_adapter ?? ''),
    observerSceneId: String(row.observer_scene_id ?? ''),
    atTargetPlatformId: String(row.at_target_platform_id ?? ''),
    wizardStep: String(row.wizard_step ?? ''),
    observedAt: Number(row.observed_at ?? 0),
  };
}

export class SceneIdentityService {
  private sceneIndex = new Map<string, string>();
  private memorySessions = new Map<string, InitSessionRecord>();
  private memoryObservations: InitObservationRecord[] = [];
  private memoryChannels: MemberChannelRecord[] = [];

  constructor(
    private sceneModel?: DbModel,
    private sessionModel?: DbModel,
    private observationModel?: DbModel,
    private channelModel?: DbModel,
  ) {}

  private sceneKey(adapter: string, sceneId: string): string {
    return `${adapter}:${sceneId}`;
  }

  async loadSceneIndex(): Promise<void> {
    this.sceneIndex.clear();
    if (!this.sceneModel) return;
    const rows = await this.sceneModel.select().where({});
    for (const row of rows) {
      const alias = rowToSceneAlias(row);
      this.sceneIndex.set(this.sceneKey(alias.adapter, alias.sceneId), alias.logicalCellId);
    }
  }

  /**
   * 解析逻辑 Cell：先 scene_aliases 表，再 fallback 到 CellService.findByScene。
   */
  resolveLogicalCell(adapter: string, sceneId: string, endpointId?: string): CollaborationCell | undefined {
    const svc = getCollaborationCellService();

    const logicalCellId = this.sceneIndex.get(this.sceneKey(adapter, sceneId));
    if (logicalCellId) {
      const cell = svc.getCell(logicalCellId);
      if (cell) return cell;
    }

    const direct = svc.findByScene(adapter, sceneId);
    if (direct) return direct;

    if (!endpointId) return undefined;
    return svc.listCells().find((c) =>
      c.members.some(
        (m) => m.endpointId === endpointId && (m.adapter ?? c.adapter) === adapter,
      ),
    );
  }

  async registerSceneAlias(logicalCellId: string, adapter: string, sceneId: string): Promise<void> {
    const key = this.sceneKey(adapter, sceneId);
    if (this.sceneIndex.get(key) === logicalCellId) return;

    this.sceneIndex.set(key, logicalCellId);
    if (!this.sceneModel) return;

    const existing = await this.sceneModel.select().where({ adapter, scene_id: sceneId });
    if (existing.length > 0) {
      await this.sceneModel.update({ logical_cell_id: logicalCellId }).where({ adapter, scene_id: sceneId });
    } else {
      await this.sceneModel.create({
        logical_cell_id: logicalCellId,
        adapter,
        scene_id: sceneId,
        created_at: Date.now(),
      } satisfies CollaborationCellSceneRow);
    }
  }

  async listAliases(logicalCellId: string): Promise<SceneAliasRecord[]> {
    const out: SceneAliasRecord[] = [];
    for (const [key, cellId] of this.sceneIndex) {
      if (cellId !== logicalCellId) continue;
      const [adapter, ...rest] = key.split(':');
      out.push({ logicalCellId: cellId, adapter: adapter!, sceneId: rest.join(':') });
    }
    return out;
  }

  // ─── Init session management ───

  async createInitSession(input: {
    id: string;
    logicalCellId: string;
    plannerEndpointId: string;
    plannerAdapter: string;
    plannerSceneId: string;
  }): Promise<InitSessionRecord> {
    const now = Date.now();
    const record: InitSessionRecord = {
      id: input.id,
      logicalCellId: input.logicalCellId,
      plannerEndpointId: input.plannerEndpointId,
      plannerAdapter: input.plannerAdapter,
      plannerSceneId: input.plannerSceneId,
      status: 'wizard',
      wizardStep: 'researcher',
      createdAt: now,
      updatedAt: now,
    };
    this.memorySessions.set(input.id, record);
    if (this.sessionModel) {
      await this.sessionModel.create({
        id: record.id,
        logical_cell_id: record.logicalCellId,
        planner_endpoint_id: record.plannerEndpointId,
        planner_adapter: record.plannerAdapter,
        planner_scene_id: record.plannerSceneId,
        status: record.status,
        wizard_step: record.wizardStep,
        created_at: now,
        updated_at: now,
      } satisfies CollaborationInitSessionRow);
    }
    return record;
  }

  async getActiveInitSession(adapter: string, sceneId: string): Promise<InitSessionRecord | null> {
    if (this.sessionModel) {
      const rows = await this.sessionModel.select().where({
        planner_adapter: adapter,
        planner_scene_id: sceneId,
        status: 'wizard',
      });
      if (rows.length > 0) return rowToInitSession(rows[0]!);
    }
    for (const s of this.memorySessions.values()) {
      if (s.plannerAdapter === adapter && s.plannerSceneId === sceneId && s.status === 'wizard') {
        return s;
      }
    }
    return null;
  }

  async getInitSession(sessionId: string): Promise<InitSessionRecord | null> {
    const mem = this.memorySessions.get(sessionId);
    if (mem) return mem;
    if (!this.sessionModel) return null;
    const rows = await this.sessionModel.select().where({ id: sessionId });
    if (rows.length === 0) return null;
    return rowToInitSession(rows[0]!);
  }

  async findActiveInitSessionForScene(adapter: string, sceneId: string): Promise<InitSessionRecord | null> {
    return this.findActiveInitSessionForInbound(adapter, sceneId);
  }

  async listActiveInitSessions(): Promise<InitSessionRecord[]> {
    const out: InitSessionRecord[] = [];
    if (this.sessionModel) {
      const rows = await this.sessionModel.select().where({ status: 'wizard' });
      for (const row of rows) out.push(rowToInitSession(row));
    }
    for (const s of this.memorySessions.values()) {
      if (s.status !== 'wizard') continue;
      if (!out.some((x) => x.id === s.id)) out.push(s);
    }
    return out;
  }

  /**
   * 入站 bot 查找进行中的 init 向导（stash 阶段）。
   * 1. planner 视角 scene 精确匹配
   * 2. 已有 observation 来自同一 adapter+scene（跨 bot 复用 session）
   * 3. 全局仅一个 wizard session（同物理群跨 adapter 冷启动）
   */
  async findActiveInitSessionForInbound(adapter: string, sceneId: string): Promise<InitSessionRecord | null> {
    const direct = await this.getActiveInitSession(adapter, sceneId);
    if (direct) return direct;

    const sessions = await this.listActiveInitSessions();
    for (const session of sessions) {
      const obs = await this.listObservations(session.id);
      if (obs.some((o) => o.observerAdapter === adapter && o.observerSceneId === sceneId)) {
        return session;
      }
    }

    if (sessions.length === 1) return sessions[0]!;
    return null;
  }

  async updateInitSessionStep(sessionId: string, wizardStep: string): Promise<void> {
    const mem = this.memorySessions.get(sessionId);
    if (mem) {
      mem.wizardStep = wizardStep;
      mem.updatedAt = Date.now();
    }
    if (this.sessionModel) {
      await this.sessionModel.update({
        wizard_step: wizardStep,
        updated_at: Date.now(),
      }).where({ id: sessionId });
    }
  }

  /**
   * CAS 推进向导步骤，避免同一 @ 消息并发处理时连跳两步。
   */
  async advanceInitSessionStepIf(
    sessionId: string,
    expectedStep: string,
    nextStep: string,
  ): Promise<boolean> {
    const mem = this.memorySessions.get(sessionId);
    if (mem) {
      if (mem.wizardStep !== expectedStep) return false;
      mem.wizardStep = nextStep;
      mem.updatedAt = Date.now();
    } else if (this.sessionModel) {
      const rows = await this.sessionModel.select().where({
        id: sessionId,
        wizard_step: expectedStep,
        status: 'wizard',
      });
      if (rows.length === 0) return false;
    } else {
      return false;
    }

    if (this.sessionModel) {
      await this.sessionModel.update({
        wizard_step: nextStep,
        updated_at: Date.now(),
      }).where({ id: sessionId, wizard_step: expectedStep });
    }
    return true;
  }

  async updateInitSessionStatus(sessionId: string, status: string, logicalCellId?: string): Promise<void> {
    const mem = this.memorySessions.get(sessionId);
    if (mem) {
      mem.status = status;
      mem.updatedAt = Date.now();
      if (logicalCellId) mem.logicalCellId = logicalCellId;
    }
    if (this.sessionModel) {
      const patch: Record<string, unknown> = { status, updated_at: Date.now() };
      if (logicalCellId) patch.logical_cell_id = logicalCellId;
      await this.sessionModel.update(patch).where({ id: sessionId });
    }
  }

  // ─── Observation management ───

  async addObservation(input: {
    sessionId: string;
    observerEndpointId: string;
    observerAdapter: string;
    observerSceneId: string;
    atTargetPlatformId: string;
    wizardStep: string;
  }): Promise<void> {
    const record: InitObservationRecord = {
      sessionId: input.sessionId,
      observerEndpointId: input.observerEndpointId,
      observerAdapter: input.observerAdapter,
      observerSceneId: input.observerSceneId,
      atTargetPlatformId: input.atTargetPlatformId,
      wizardStep: input.wizardStep,
      observedAt: Date.now(),
    };
    this.memoryObservations.push(record);
    if (this.observationModel) {
      await this.observationModel.create({
        session_id: record.sessionId,
        observer_endpoint_id: record.observerEndpointId,
        observer_adapter: record.observerAdapter,
        observer_scene_id: record.observerSceneId,
        at_target_platform_id: record.atTargetPlatformId,
        wizard_step: record.wizardStep,
        observed_at: record.observedAt,
      } satisfies CollaborationInitObservationRow);
    }
  }

  async listObservations(sessionId: string): Promise<InitObservationRecord[]> {
    if (this.observationModel) {
      const rows = await this.observationModel.select().where({ session_id: sessionId });
      return rows.map(rowToObservation);
    }
    return this.memoryObservations.filter((o) => o.sessionId === sessionId);
  }

  /**
   * 从 stash observations 计算 init 计划（不写 Cell / alias / channel）。
   */
  planInitFromObservations(
    logicalCellId: string,
    observations: InitObservationRecord[],
    registeredEndpoints: Map<string, { adapter: string; endpointId: string }>,
    options?: { plannerEndpointId?: string },
  ): {
    sceneAliases: SceneAliasRecord[];
    members: Array<{ endpointId: string; adapter: string; pipelineRole: string }>;
    channels: MemberChannelRecord[];
  } {
    const sceneSet = new Map<string, SceneAliasRecord>();
    for (const obs of observations) {
      const key = this.sceneKey(obs.observerAdapter, obs.observerSceneId);
      if (!sceneSet.has(key)) {
        sceneSet.set(key, {
          logicalCellId,
          adapter: obs.observerAdapter,
          sceneId: obs.observerSceneId,
        });
      }
    }

    const roleMap = new Map<string, { endpointId: string; adapter: string; pipelineRole: string }>();
    const channelDedup = new Set<string>();
    const channels: MemberChannelRecord[] = [];

    const roleObs = options?.plannerEndpointId
      ? observations.filter((o) => o.observerEndpointId === options.plannerEndpointId)
      : observations;

    const assignRole = (obs: InitObservationRecord) => {
      if (!obs.wizardStep || !obs.atTargetPlatformId) return;
      if (!isPipelineRole(obs.wizardStep)) return;
      const ep = registeredEndpoints.get(obs.atTargetPlatformId);
      if (!ep) return;
      if (roleMap.has(obs.wizardStep)) return;
      roleMap.set(obs.wizardStep, {
        endpointId: ep.endpointId,
        adapter: ep.adapter,
        pipelineRole: obs.wizardStep,
      });
    };

    for (const obs of roleObs) assignRole(obs);
    if (options?.plannerEndpointId) {
      for (const obs of observations) assignRole(obs);
    }

    for (const obs of observations) {
      if (!obs.wizardStep || !obs.atTargetPlatformId) continue;
      if (!isPipelineRole(obs.wizardStep)) continue;
      const ep = registeredEndpoints.get(obs.atTargetPlatformId);
      if (!ep) continue;

      const chKey = `${obs.wizardStep}:${obs.observerAdapter}:${obs.observerSceneId}:${obs.atTargetPlatformId}`;
      if (!channelDedup.has(chKey)) {
        channelDedup.add(chKey);
        channels.push({
          logicalCellId,
          endpointId: ep.endpointId,
          pipelineRole: obs.wizardStep,
          adapter: obs.observerAdapter,
          sceneId: obs.observerSceneId,
          botId: obs.atTargetPlatformId,
        });
      }
    }

    return {
      sceneAliases: [...sceneSet.values()],
      members: [...roleMap.values()],
      channels,
    };
  }

  /**
   * /collab inited 一次性提交：写 scene_aliases + member_channels（Cell 由上层 upsert）。
   */
  async commitInitPlan(input: {
    logicalCellId: string;
    sceneAliases: SceneAliasRecord[];
    channels: MemberChannelRecord[];
  }): Promise<void> {
    for (const alias of input.sceneAliases) {
      await this.registerSceneAlias(input.logicalCellId, alias.adapter, alias.sceneId);
    }
    await this.saveMemberChannels(input.logicalCellId, input.channels);
  }

  /** @deprecated 使用 planInitFromObservations + commitInitPlan */
  async aggregateObservations(
    sessionId: string,
    logicalCellId: string,
    registeredEndpoints: Map<string, { adapter: string; endpointId: string }>,
  ): Promise<{
    sceneAliases: SceneAliasRecord[];
    members: Array<{ endpointId: string; adapter: string; pipelineRole: string }>;
    channels: MemberChannelRecord[];
  }> {
    const observations = await this.listObservations(sessionId);
    const plan = this.planInitFromObservations(logicalCellId, observations, registeredEndpoints);
    await this.commitInitPlan({
      logicalCellId,
      sceneAliases: plan.sceneAliases,
      channels: plan.channels,
    });
    return plan;
  }

  // ─── Member channel (identity edge) management ───

  async saveMemberChannels(logicalCellId: string, channels: MemberChannelRecord[]): Promise<void> {
    this.memoryChannels = this.memoryChannels.filter((c) => c.logicalCellId !== logicalCellId);
    this.memoryChannels.push(...channels);

    if (!this.channelModel) return;

    if (this.channelModel.delete) {
      await this.channelModel.delete().where({ logical_cell_id: logicalCellId });
    }
    for (const ch of channels) {
      await this.channelModel.create({
        logical_cell_id: ch.logicalCellId,
        endpoint_id: ch.endpointId,
        pipeline_role: ch.pipelineRole,
        adapter: ch.adapter,
        scene_id: ch.sceneId,
        bot_id: ch.botId,
        created_at: Date.now(),
      } satisfies CollaborationCellMemberChannelRow);
    }
  }

  async listMemberChannels(logicalCellId: string): Promise<MemberChannelRecord[]> {
    if (this.channelModel) {
      const rows = await this.channelModel.select().where({ logical_cell_id: logicalCellId });
      return rows.map((row) => ({
        logicalCellId: String(row.logical_cell_id ?? ''),
        endpointId: String(row.endpoint_id ?? ''),
        pipelineRole: String(row.pipeline_role ?? ''),
        adapter: String(row.adapter ?? ''),
        sceneId: String(row.scene_id ?? ''),
        botId: String(row.bot_id ?? ''),
      }));
    }
    return this.memoryChannels.filter((c) => c.logicalCellId === logicalCellId);
  }

  /**
   * 构建协作群全景图 — 输出 { group_id, group_name, agents[].channels[] }。
   */
  async buildGroupView(logicalCellId: string, groupName?: string): Promise<GroupView> {
    const channels = await this.listMemberChannels(logicalCellId);
    const cellSvc = getCollaborationCellService();
    const cell = cellSvc.getCell(logicalCellId);

    const agentMap = new Map<string, GroupViewAgent>();
    for (const ch of channels) {
      let agent = agentMap.get(ch.pipelineRole);
      if (!agent) {
        agent = { name: ch.pipelineRole, channels: [] };
        agentMap.set(ch.pipelineRole, agent);
      }
      agent.channels.push({
        adapter: ch.adapter,
        scene_id: ch.sceneId,
        bot_id: ch.botId,
      });
    }

    return {
      group_id: logicalCellId,
      group_name: groupName ?? cell?.goal ?? '',
      agents: [...agentMap.values()],
    };
  }
}

let globalSceneIdentityService: SceneIdentityService | null = null;

export function getSceneIdentityService(): SceneIdentityService {
  if (!globalSceneIdentityService) {
    globalSceneIdentityService = new SceneIdentityService();
  }
  return globalSceneIdentityService;
}

export function setSceneIdentityService(svc: SceneIdentityService | null): void {
  globalSceneIdentityService = svc;
}

export function createSceneIdentityService(
  sceneModel?: DbModel,
  sessionModel?: DbModel,
  observationModel?: DbModel,
  channelModel?: DbModel,
): SceneIdentityService {
  return new SceneIdentityService(sceneModel, sessionModel, observationModel, channelModel);
}
