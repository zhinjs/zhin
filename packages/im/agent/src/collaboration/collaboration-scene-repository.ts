/**
 * CollaborationSceneRepository — cells + members 关联表持久化。
 */

import { type CollaborationScene, type PipelineState, isPipelineRole } from './types.js';
import {
  memberInputToRow,
  memberRowToRecord,
  type CollaborationSceneMemberRecord,
  type CollaborationSceneMemberRow,
  type CollaborationSceneRecord,
  type UpsertCollaborationSceneInput,
  type UpsertCollaborationMemberInput,
} from './collaboration-db-model.js';
export type {
  UpsertCollaborationSceneInput,
  UpsertCollaborationMemberInput,
  CollaborationSceneMemberRecord,
} from './collaboration-db-model.js';

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

export interface CollaborationSceneRepository {
  listEnabled(): Promise<CollaborationScene[]>;
  getById(id: string): Promise<CollaborationScene | null>;
  findByScene(adapter: string, sceneId: string): Promise<CollaborationScene | null>;
  findScenesByEndpoint(endpointId: string): Promise<CollaborationScene[]>;
  upsert(input: UpsertCollaborationSceneInput): Promise<CollaborationScene>;
  updateGoal(id: string, goal: string, expectedVersion?: number): Promise<
    { ok: true; scene: CollaborationScene } | { ok: false; error: string }
  >;
  setMissionRunId(id: string, missionRunId: string): Promise<void>;
  setPipelineState(id: string, state: PipelineState): Promise<void>;
  /** 乐观锁 patch：version 冲突时自动重试（默认 5 次） */
  patchPipelineState(
    id: string,
    patch: (prev: PipelineState | undefined, cell: CollaborationScene) => PipelineState | undefined,
    maxRetries?: number,
  ): Promise<
    { ok: true; scene: CollaborationScene } | { ok: false; error: string; conflict?: boolean }
  >;
  delete(id: string): Promise<boolean>;
  listMembers(collaborationSceneId: string): Promise<CollaborationSceneMemberRecord[]>;
  addMember(collaborationSceneId: string, input: UpsertCollaborationMemberInput): Promise<
    { ok: true; member: CollaborationSceneMemberRecord } | { ok: false; error: string }
  >;
  updateMember(
    collaborationSceneId: string,
    endpointId: string,
    patch: Partial<UpsertCollaborationMemberInput>,
  ): Promise<{ ok: true; member: CollaborationSceneMemberRecord } | { ok: false; error: string }>;
  removeMember(collaborationSceneId: string, endpointId: string): Promise<boolean>;
}

/** node:sqlite 方言会把 JSON 形态的 TEXT 预解析为 object，不能直接 String()。 */
function coerceTextJsonColumn(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

function rowToSceneRecord(row: Record<string, unknown>): CollaborationSceneRecord {
  return {
    id: String(row.id ?? ''),
    adapter: String(row.adapter ?? ''),
    scene_id: String(row.scene_id ?? ''),
    goal: String(row.goal ?? ''),
    mission_run_id: String(row.mission_run_id ?? ''),
    pipeline_state: coerceTextJsonColumn(row.pipeline_state),
    version: Number(row.version ?? 0),
    enabled: Number(row.enabled ?? 1),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
  };
}

function rowToMemberRow(row: Record<string, unknown>): CollaborationSceneMemberRow {
  return {
    collaboration_scene_id: String(row.collaboration_scene_id ?? ''),
    adapter: String(row.adapter ?? ''),
    endpoint_id: String(row.endpoint_id ?? ''),
    primary: String(row.primary ?? ''),
    role: String(row.role ?? ''),
    pipeline_role: String(row.pipeline_role ?? ''),
    sort_order: Number(row.sort_order ?? 0),
    enabled: Number(row.enabled ?? 1),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
  };
}

function parsePipelineState(raw: string): import('./types.js').PipelineState | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as import('./types.js').PipelineState;
    if (parsed && typeof parsed === 'object' && typeof parsed.stage === 'string') return parsed;
  } catch {
    // 损坏的 pipeline_state 忽略，回退未初始化
  }
  return undefined;
}

function assembleScene(record: CollaborationSceneRecord, members: CollaborationSceneMemberRecord[]): CollaborationScene {
  return {
    id: record.id,
    adapter: record.adapter,
    sceneId: record.scene_id,
    goal: record.goal || undefined,
    missionRunId: record.mission_run_id || undefined,
    pipelineState: parsePipelineState(record.pipeline_state),
    members: members
      .filter((m) => m.enabled !== false)
      .map((m) => ({
        endpointId: m.endpointId,
        adapter: m.adapter,
        primary: m.primary,
        role: m.role,
        pipelineRole: isPipelineRole(m.pipelineRole) ? m.pipelineRole : undefined,
      })),
    version: record.version,
  };
}

abstract class CollaborationSceneRepositoryBase implements CollaborationSceneRepository {
  protected abstract getSceneRecord(id: string): Promise<CollaborationSceneRecord | null>;
  protected abstract listSceneRecords(enabledOnly?: boolean): Promise<CollaborationSceneRecord[]>;
  protected abstract findSceneRecordByImScene(adapter: string, sceneId: string): Promise<CollaborationSceneRecord | null>;
  protected abstract writeSceneRecord(record: CollaborationSceneRecord): Promise<void>;
  protected abstract deleteSceneRecord(id: string): Promise<boolean>;
  protected abstract listMemberRows(collaborationSceneId: string): Promise<CollaborationSceneMemberRow[]>;
  protected abstract listMemberRowsByEndpoint(endpointId: string): Promise<CollaborationSceneMemberRow[]>;
  protected abstract getMemberRow(collaborationSceneId: string, endpointId: string): Promise<CollaborationSceneMemberRow | null>;
  protected abstract writeMemberRow(row: CollaborationSceneMemberRow): Promise<void>;
  protected abstract deleteMemberRow(collaborationSceneId: string, endpointId: string): Promise<boolean>;
  protected abstract deleteMembersForScene(collaborationSceneId: string): Promise<void>;
  protected abstract replaceMembers(collaborationSceneId: string, members: CollaborationSceneMemberRecord[]): Promise<void>;

  private async loadScene(id: string): Promise<CollaborationScene | null> {
    const record = await this.getSceneRecord(id);
    if (!record || record.enabled === 0) return null;
    const rows = await this.listMemberRows(id);
    return assembleScene(record, rows.map(memberRowToRecord));
  }

  async listEnabled(): Promise<CollaborationScene[]> {
    const records = await this.listSceneRecords(true);
    const out: CollaborationScene[] = [];
    for (const record of records) {
      const rows = await this.listMemberRows(record.id);
      out.push(assembleScene(record, rows.map(memberRowToRecord)));
    }
    return out;
  }

  async getById(id: string): Promise<CollaborationScene | null> {
    return this.loadScene(id);
  }

  async findByScene(adapter: string, sceneId: string): Promise<CollaborationScene | null> {
    const record = await this.findSceneRecordByImScene(adapter, sceneId);
    if (!record) return null;
    const rows = await this.listMemberRows(record.id);
    return assembleScene(record, rows.map(memberRowToRecord));
  }

  async findScenesByEndpoint(endpointId: string): Promise<CollaborationScene[]> {
    const memberRows = await this.listMemberRowsByEndpoint(endpointId);
    const cellIds = [...new Set(memberRows.filter((m) => m.enabled !== 0).map((m) => m.collaboration_scene_id))];
    const cells: CollaborationScene[] = [];
    for (const collaborationSceneId of cellIds) {
      const cell = await this.loadScene(collaborationSceneId);
      if (cell) cells.push(cell);
    }
    return cells;
  }

  async upsert(input: UpsertCollaborationSceneInput): Promise<CollaborationScene> {
    const now = Date.now();
    const existing = await this.getSceneRecord(input.id);
    const record: CollaborationSceneRecord = {
      id: input.id,
      adapter: input.adapter,
      scene_id: input.sceneId,
      goal: input.goal ?? existing?.goal ?? '',
      mission_run_id: input.missionRunId ?? existing?.mission_run_id ?? '',
      pipeline_state: input.pipelineState ?? existing?.pipeline_state ?? '',
      version: existing ? existing.version + 1 : 0,
      enabled: input.enabled === false ? 0 : 1,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.writeSceneRecord(record);
    if (input.members) {
      await this.replaceMembers(input.id, input.members);
    }
    return (await this.loadScene(input.id))!;
  }

  async updateGoal(
    id: string,
    goal: string,
    expectedVersion?: number,
  ): Promise<{ ok: true; scene: CollaborationScene } | { ok: false; error: string }> {
    const existing = await this.getSceneRecord(id);
    if (!existing) return { ok: false, error: `Cell ${id} not found` };
    if (expectedVersion != null && expectedVersion !== existing.version) {
      return { ok: false, error: `Version conflict: expected ${expectedVersion}, got ${existing.version}` };
    }
    const record: CollaborationSceneRecord = {
      ...existing,
      goal,
      version: existing.version + 1,
      updated_at: Date.now(),
    };
    await this.writeSceneRecord(record);
    const cell = await this.loadScene(id);
    return cell ? { ok: true, scene: cell } : { ok: false, error: 'Update failed' };
  }

  async setMissionRunId(id: string, missionRunId: string): Promise<void> {
    const existing = await this.getSceneRecord(id);
    if (!existing) return;
    await this.writeSceneRecord({
      ...existing,
      mission_run_id: missionRunId,
      version: existing.version + 1,
      updated_at: Date.now(),
    });
  }

  async setPipelineState(id: string, state: PipelineState): Promise<void> {
    const existing = await this.getSceneRecord(id);
    if (!existing) return;
    await this.writeSceneRecord({
      ...existing,
      pipeline_state: JSON.stringify(state),
      version: existing.version + 1,
      updated_at: Date.now(),
    });
  }

  async patchPipelineState(
    id: string,
    patch: (prev: PipelineState | undefined, cell: CollaborationScene) => PipelineState | undefined,
    maxRetries = 5,
  ): Promise<
    { ok: true; scene: CollaborationScene } | { ok: false; error: string; conflict?: boolean }
  > {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const before = await this.getSceneRecord(id);
      if (!before) return { ok: false, error: `Cell ${id} not found` };
      const cellBefore = await this.loadScene(id);
      if (!cellBefore) return { ok: false, error: `Cell ${id} not found` };
      const prev = cellBefore.pipelineState;
      const next = patch(prev, cellBefore);
      if (next === undefined) {
        return { ok: true, scene: cellBefore };
      }
      const recheck = await this.getSceneRecord(id);
      if (!recheck || recheck.version !== before.version) {
        continue;
      }
      await this.writeSceneRecord({
        ...recheck,
        pipeline_state: JSON.stringify(next),
        version: recheck.version + 1,
        updated_at: Date.now(),
      });
      const cell = await this.loadScene(id);
      return cell ? { ok: true, scene: cell } : { ok: false, error: 'Update failed' };
    }
    return { ok: false, error: 'pipeline_state_conflict', conflict: true };
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.getSceneRecord(id);
    if (!existing) return false;
    await this.deleteMembersForScene(id);
    return this.deleteSceneRecord(id);
  }

  async listMembers(collaborationSceneId: string): Promise<CollaborationSceneMemberRecord[]> {
    const rows = await this.listMemberRows(collaborationSceneId);
    return rows.map(memberRowToRecord).filter((m) => m.enabled !== false);
  }

  async addMember(
    collaborationSceneId: string,
    input: UpsertCollaborationMemberInput,
  ): Promise<{ ok: true; member: CollaborationSceneMemberRecord } | { ok: false; error: string }> {
    const cell = await this.getSceneRecord(collaborationSceneId);
    if (!cell) return { ok: false, error: `Cell ${collaborationSceneId} not found` };
    const dup = await this.getMemberRow(collaborationSceneId, input.endpointId);
    if (dup) return { ok: false, error: `Member ${input.endpointId} already exists` };
    const row = memberInputToRow(collaborationSceneId, input);
    await this.writeMemberRow(row);
    await this.bumpSceneVersion(collaborationSceneId);
    return { ok: true, member: memberRowToRecord(row) };
  }

  async updateMember(
    collaborationSceneId: string,
    endpointId: string,
    patch: Partial<UpsertCollaborationMemberInput>,
  ): Promise<{ ok: true; member: CollaborationSceneMemberRecord } | { ok: false; error: string }> {
    const existing = await this.getMemberRow(collaborationSceneId, endpointId);
    if (!existing) return { ok: false, error: `Member ${endpointId} not found` };
    const row = memberInputToRow(collaborationSceneId, {
      endpointId,
      primary: patch.primary ?? existing.primary,
      role: patch.role ?? (existing.role || undefined),
      pipelineRole: patch.pipelineRole ?? (existing.pipeline_role || undefined),
      sortOrder: patch.sortOrder ?? existing.sort_order,
      enabled: patch.enabled,
    }, Date.now(), existing);
    await this.writeMemberRow(row);
    await this.bumpSceneVersion(collaborationSceneId);
    return { ok: true, member: memberRowToRecord(row) };
  }

  async removeMember(collaborationSceneId: string, endpointId: string): Promise<boolean> {
    const ok = await this.deleteMemberRow(collaborationSceneId, endpointId);
    if (ok) await this.bumpSceneVersion(collaborationSceneId);
    return ok;
  }

  private async bumpSceneVersion(collaborationSceneId: string): Promise<void> {
    const cell = await this.getSceneRecord(collaborationSceneId);
    if (!cell) return;
    await this.writeSceneRecord({
      ...cell,
      version: cell.version + 1,
      updated_at: Date.now(),
    });
  }
}

export class MemoryCollaborationSceneRepository extends CollaborationSceneRepositoryBase {
  private cells = new Map<string, CollaborationSceneRecord>();
  private members = new Map<string, CollaborationSceneMemberRow[]>();

  protected async getSceneRecord(id: string): Promise<CollaborationSceneRecord | null> {
    return this.cells.get(id) ?? null;
  }

  protected async listSceneRecords(enabledOnly = false): Promise<CollaborationSceneRecord[]> {
    return [...this.cells.values()].filter((r) => !enabledOnly || r.enabled !== 0);
  }

  protected async findSceneRecordByImScene(adapter: string, sceneId: string): Promise<CollaborationSceneRecord | null> {
    for (const row of this.cells.values()) {
      if (row.enabled !== 0 && row.adapter === adapter && row.scene_id === sceneId) return row;
    }
    return null;
  }

  protected async writeSceneRecord(record: CollaborationSceneRecord): Promise<void> {
    this.cells.set(record.id, record);
  }

  protected async deleteSceneRecord(id: string): Promise<boolean> {
    return this.cells.delete(id);
  }

  protected async listMemberRows(collaborationSceneId: string): Promise<CollaborationSceneMemberRow[]> {
    return [...(this.members.get(collaborationSceneId) ?? [])];
  }

  protected async listMemberRowsByEndpoint(endpointId: string): Promise<CollaborationSceneMemberRow[]> {
    const out: CollaborationSceneMemberRow[] = [];
    for (const rows of this.members.values()) {
      for (const row of rows) {
        if (row.endpoint_id === endpointId) out.push(row);
      }
    }
    return out;
  }

  protected async getMemberRow(collaborationSceneId: string, endpointId: string): Promise<CollaborationSceneMemberRow | null> {
    return (this.members.get(collaborationSceneId) ?? []).find((m) => m.endpoint_id === endpointId) ?? null;
  }

  protected async writeMemberRow(row: CollaborationSceneMemberRow): Promise<void> {
    const list = [...(this.members.get(row.collaboration_scene_id) ?? [])];
    const idx = list.findIndex((m) => m.endpoint_id === row.endpoint_id);
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    list.sort((a, b) => a.sort_order - b.sort_order || a.endpoint_id.localeCompare(b.endpoint_id));
    this.members.set(row.collaboration_scene_id, list);
  }

  protected async deleteMemberRow(collaborationSceneId: string, endpointId: string): Promise<boolean> {
    const list = this.members.get(collaborationSceneId);
    if (!list) return false;
    const next = list.filter((m) => m.endpoint_id !== endpointId);
    if (next.length === list.length) return false;
    this.members.set(collaborationSceneId, next);
    return true;
  }

  protected async deleteMembersForScene(collaborationSceneId: string): Promise<void> {
    this.members.delete(collaborationSceneId);
  }

  protected async replaceMembers(collaborationSceneId: string, members: CollaborationSceneMemberRecord[]): Promise<void> {
    const now = Date.now();
    const rows = members.map((m, i) => memberInputToRow(collaborationSceneId, { ...m, sortOrder: m.sortOrder ?? i }));
    for (const row of rows) {
      row.created_at = (await this.getMemberRow(collaborationSceneId, row.endpoint_id))?.created_at ?? now;
    }
    this.members.set(collaborationSceneId, rows);
  }
}

export class DatabaseCollaborationSceneRepository extends CollaborationSceneRepositoryBase {
  constructor(
    private readonly cellModel: DbModel,
    private readonly memberModel: DbModel,
  ) {
    super();
  }

  protected async getSceneRecord(id: string): Promise<CollaborationSceneRecord | null> {
    const rows = await this.cellModel.select().where({ id });
    if (!rows.length) return null;
    return rowToSceneRecord(rows[0]!);
  }

  protected async listSceneRecords(enabledOnly = false): Promise<CollaborationSceneRecord[]> {
    const rows = await this.cellModel.select().where(enabledOnly ? { enabled: 1 } : {});
    return rows.map(rowToSceneRecord);
  }

  protected async findSceneRecordByImScene(adapter: string, sceneId: string): Promise<CollaborationSceneRecord | null> {
    const rows = await this.cellModel.select().where({ adapter, scene_id: sceneId, enabled: 1 });
    if (!rows.length) return null;
    return rowToSceneRecord(rows[0]!);
  }

  protected async writeSceneRecord(record: CollaborationSceneRecord): Promise<void> {
    const existing = await this.getSceneRecord(record.id);
    if (!existing) {
      await this.cellModel.create({ ...record });
      return;
    }
    await this.cellModel.update({ ...record }).where({ id: record.id });
  }

  protected async deleteSceneRecord(id: string): Promise<boolean> {
    if (!this.cellModel.delete) return false;
    const existing = await this.getSceneRecord(id);
    if (!existing) return false;
    await this.cellModel.delete().where({ id });
    return true;
  }

  protected async listMemberRows(collaborationSceneId: string): Promise<CollaborationSceneMemberRow[]> {
    const rows = await this.memberModel.select().where({ collaboration_scene_id: collaborationSceneId });
    return rows.map(rowToMemberRow).sort((a, b) => a.sort_order - b.sort_order);
  }

  protected async listMemberRowsByEndpoint(endpointId: string): Promise<CollaborationSceneMemberRow[]> {
    const rows = await this.memberModel.select().where({ endpoint_id: endpointId, enabled: 1 });
    return rows.map(rowToMemberRow);
  }

  protected async getMemberRow(collaborationSceneId: string, endpointId: string): Promise<CollaborationSceneMemberRow | null> {
    const rows = await this.memberModel.select().where({ collaboration_scene_id: collaborationSceneId, endpoint_id: endpointId });
    if (!rows.length) return null;
    return rowToMemberRow(rows[0]!);
  }

  protected async writeMemberRow(row: CollaborationSceneMemberRow): Promise<void> {
    const existing = await this.getMemberRow(row.collaboration_scene_id, row.endpoint_id);
    if (!existing) {
      await this.memberModel.create({ ...row });
      return;
    }
    await this.memberModel.update({ ...row }).where({ collaboration_scene_id: row.collaboration_scene_id, endpoint_id: row.endpoint_id });
  }

  protected async deleteMemberRow(collaborationSceneId: string, endpointId: string): Promise<boolean> {
    if (!this.memberModel.delete) return false;
    const existing = await this.getMemberRow(collaborationSceneId, endpointId);
    if (!existing) return false;
    await this.memberModel.delete().where({ collaboration_scene_id: collaborationSceneId, endpoint_id: endpointId });
    return true;
  }

  protected async deleteMembersForScene(collaborationSceneId: string): Promise<void> {
    if (!this.memberModel.delete) return;
    const rows = await this.listMemberRows(collaborationSceneId);
    for (const row of rows) {
      await this.memberModel.delete().where({ collaboration_scene_id: collaborationSceneId, endpoint_id: row.endpoint_id });
    }
  }

  protected async replaceMembers(collaborationSceneId: string, members: CollaborationSceneMemberRecord[]): Promise<void> {
    const existing = await this.listMemberRows(collaborationSceneId);
    const nextIds = new Set(members.map((m) => m.endpointId));
    for (const row of existing) {
      if (!nextIds.has(row.endpoint_id)) {
        await this.deleteMemberRow(collaborationSceneId, row.endpoint_id);
      }
    }
    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      const prev = existing.find((r) => r.endpoint_id === m.endpointId);
      await this.writeMemberRow(memberInputToRow(collaborationSceneId, { ...m, sortOrder: m.sortOrder ?? i }, Date.now(), prev));
    }
  }
}

let globalRepository: CollaborationSceneRepository | null = null;

export function getCollaborationSceneRepository(): CollaborationSceneRepository {
  if (!globalRepository) {
    globalRepository = new MemoryCollaborationSceneRepository();
  }
  return globalRepository;
}

export function setCollaborationSceneRepository(repo: CollaborationSceneRepository | null): void {
  globalRepository = repo;
}

export function createCollaborationSceneRepository(
  cellModel?: DbModel,
  memberModel?: DbModel,
): CollaborationSceneRepository {
  if (cellModel && memberModel) {
    return new DatabaseCollaborationSceneRepository(cellModel, memberModel);
  }
  return new MemoryCollaborationSceneRepository();
}
