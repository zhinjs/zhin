/**
 * CollaborationCellRepository — cells + members 关联表持久化。
 */

import type { CollaborationCell, PipelineState } from './types.js';
import { isPipelineRole } from './types.js';
import {
  memberInputToRow,
  memberRowToRecord,
  type CollaborationCellMemberRecord,
  type CollaborationCellMemberRow,
  type CollaborationCellRecord,
  type UpsertCollaborationCellInput,
  type UpsertCollaborationMemberInput,
} from './collaboration-db-model.js';

export type {
  UpsertCollaborationCellInput,
  UpsertCollaborationMemberInput,
  CollaborationCellMemberRecord,
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

export interface CollaborationCellRepository {
  listEnabled(): Promise<CollaborationCell[]>;
  getById(id: string): Promise<CollaborationCell | null>;
  findByScene(adapter: string, sceneId: string): Promise<CollaborationCell | null>;
  findCellsByEndpoint(endpointId: string): Promise<CollaborationCell[]>;
  upsert(input: UpsertCollaborationCellInput): Promise<CollaborationCell>;
  updateGoal(id: string, goal: string, expectedVersion?: number): Promise<
    { ok: true; cell: CollaborationCell } | { ok: false; error: string }
  >;
  setMissionRunId(id: string, missionRunId: string): Promise<void>;
  setPipelineState(id: string, state: PipelineState): Promise<void>;
  /** 乐观锁 patch：version 冲突时自动重试（默认 5 次） */
  patchPipelineState(
    id: string,
    patch: (prev: PipelineState | undefined, cell: CollaborationCell) => PipelineState | undefined,
    maxRetries?: number,
  ): Promise<
    { ok: true; cell: CollaborationCell } | { ok: false; error: string; conflict?: boolean }
  >;
  delete(id: string): Promise<boolean>;
  listMembers(cellId: string): Promise<CollaborationCellMemberRecord[]>;
  addMember(cellId: string, input: UpsertCollaborationMemberInput): Promise<
    { ok: true; member: CollaborationCellMemberRecord } | { ok: false; error: string }
  >;
  updateMember(
    cellId: string,
    endpointId: string,
    patch: Partial<UpsertCollaborationMemberInput>,
  ): Promise<{ ok: true; member: CollaborationCellMemberRecord } | { ok: false; error: string }>;
  removeMember(cellId: string, endpointId: string): Promise<boolean>;
}

/** node:sqlite 方言会把 JSON 形态的 TEXT 预解析为 object，不能直接 String()。 */
function coerceTextJsonColumn(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

function rowToCellRecord(row: Record<string, unknown>): CollaborationCellRecord {
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

function rowToMemberRow(row: Record<string, unknown>): CollaborationCellMemberRow {
  return {
    cell_id: String(row.cell_id ?? ''),
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

function assembleCell(record: CollaborationCellRecord, members: CollaborationCellMemberRecord[]): CollaborationCell {
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

abstract class CollaborationCellRepositoryBase implements CollaborationCellRepository {
  protected abstract getCellRecord(id: string): Promise<CollaborationCellRecord | null>;
  protected abstract listCellRecords(enabledOnly?: boolean): Promise<CollaborationCellRecord[]>;
  protected abstract findCellRecordByScene(adapter: string, sceneId: string): Promise<CollaborationCellRecord | null>;
  protected abstract writeCellRecord(record: CollaborationCellRecord): Promise<void>;
  protected abstract deleteCellRecord(id: string): Promise<boolean>;
  protected abstract listMemberRows(cellId: string): Promise<CollaborationCellMemberRow[]>;
  protected abstract listMemberRowsByEndpoint(endpointId: string): Promise<CollaborationCellMemberRow[]>;
  protected abstract getMemberRow(cellId: string, endpointId: string): Promise<CollaborationCellMemberRow | null>;
  protected abstract writeMemberRow(row: CollaborationCellMemberRow): Promise<void>;
  protected abstract deleteMemberRow(cellId: string, endpointId: string): Promise<boolean>;
  protected abstract deleteMembersForCell(cellId: string): Promise<void>;
  protected abstract replaceMembers(cellId: string, members: CollaborationCellMemberRecord[]): Promise<void>;

  private async loadCell(id: string): Promise<CollaborationCell | null> {
    const record = await this.getCellRecord(id);
    if (!record || record.enabled === 0) return null;
    const rows = await this.listMemberRows(id);
    return assembleCell(record, rows.map(memberRowToRecord));
  }

  async listEnabled(): Promise<CollaborationCell[]> {
    const records = await this.listCellRecords(true);
    const out: CollaborationCell[] = [];
    for (const record of records) {
      const rows = await this.listMemberRows(record.id);
      out.push(assembleCell(record, rows.map(memberRowToRecord)));
    }
    return out;
  }

  async getById(id: string): Promise<CollaborationCell | null> {
    return this.loadCell(id);
  }

  async findByScene(adapter: string, sceneId: string): Promise<CollaborationCell | null> {
    const record = await this.findCellRecordByScene(adapter, sceneId);
    if (!record) return null;
    const rows = await this.listMemberRows(record.id);
    return assembleCell(record, rows.map(memberRowToRecord));
  }

  async findCellsByEndpoint(endpointId: string): Promise<CollaborationCell[]> {
    const memberRows = await this.listMemberRowsByEndpoint(endpointId);
    const cellIds = [...new Set(memberRows.filter((m) => m.enabled !== 0).map((m) => m.cell_id))];
    const cells: CollaborationCell[] = [];
    for (const cellId of cellIds) {
      const cell = await this.loadCell(cellId);
      if (cell) cells.push(cell);
    }
    return cells;
  }

  async upsert(input: UpsertCollaborationCellInput): Promise<CollaborationCell> {
    const now = Date.now();
    const existing = await this.getCellRecord(input.id);
    const record: CollaborationCellRecord = {
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
    await this.writeCellRecord(record);
    if (input.members) {
      await this.replaceMembers(input.id, input.members);
    }
    return (await this.loadCell(input.id))!;
  }

  async updateGoal(
    id: string,
    goal: string,
    expectedVersion?: number,
  ): Promise<{ ok: true; cell: CollaborationCell } | { ok: false; error: string }> {
    const existing = await this.getCellRecord(id);
    if (!existing) return { ok: false, error: `Cell ${id} not found` };
    if (expectedVersion != null && expectedVersion !== existing.version) {
      return { ok: false, error: `Version conflict: expected ${expectedVersion}, got ${existing.version}` };
    }
    const record: CollaborationCellRecord = {
      ...existing,
      goal,
      version: existing.version + 1,
      updated_at: Date.now(),
    };
    await this.writeCellRecord(record);
    const cell = await this.loadCell(id);
    return cell ? { ok: true, cell } : { ok: false, error: 'Update failed' };
  }

  async setMissionRunId(id: string, missionRunId: string): Promise<void> {
    const existing = await this.getCellRecord(id);
    if (!existing) return;
    await this.writeCellRecord({
      ...existing,
      mission_run_id: missionRunId,
      version: existing.version + 1,
      updated_at: Date.now(),
    });
  }

  async setPipelineState(id: string, state: PipelineState): Promise<void> {
    const existing = await this.getCellRecord(id);
    if (!existing) return;
    await this.writeCellRecord({
      ...existing,
      pipeline_state: JSON.stringify(state),
      version: existing.version + 1,
      updated_at: Date.now(),
    });
  }

  async patchPipelineState(
    id: string,
    patch: (prev: PipelineState | undefined, cell: CollaborationCell) => PipelineState | undefined,
    maxRetries = 5,
  ): Promise<
    { ok: true; cell: CollaborationCell } | { ok: false; error: string; conflict?: boolean }
  > {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const before = await this.getCellRecord(id);
      if (!before) return { ok: false, error: `Cell ${id} not found` };
      const cellBefore = await this.loadCell(id);
      if (!cellBefore) return { ok: false, error: `Cell ${id} not found` };
      const prev = cellBefore.pipelineState;
      const next = patch(prev, cellBefore);
      if (next === undefined) {
        return { ok: true, cell: cellBefore };
      }
      const recheck = await this.getCellRecord(id);
      if (!recheck || recheck.version !== before.version) {
        continue;
      }
      await this.writeCellRecord({
        ...recheck,
        pipeline_state: JSON.stringify(next),
        version: recheck.version + 1,
        updated_at: Date.now(),
      });
      const cell = await this.loadCell(id);
      return cell ? { ok: true, cell } : { ok: false, error: 'Update failed' };
    }
    return { ok: false, error: 'pipeline_state_conflict', conflict: true };
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.getCellRecord(id);
    if (!existing) return false;
    await this.deleteMembersForCell(id);
    return this.deleteCellRecord(id);
  }

  async listMembers(cellId: string): Promise<CollaborationCellMemberRecord[]> {
    const rows = await this.listMemberRows(cellId);
    return rows.map(memberRowToRecord).filter((m) => m.enabled !== false);
  }

  async addMember(
    cellId: string,
    input: UpsertCollaborationMemberInput,
  ): Promise<{ ok: true; member: CollaborationCellMemberRecord } | { ok: false; error: string }> {
    const cell = await this.getCellRecord(cellId);
    if (!cell) return { ok: false, error: `Cell ${cellId} not found` };
    const dup = await this.getMemberRow(cellId, input.endpointId);
    if (dup) return { ok: false, error: `Member ${input.endpointId} already exists` };
    const row = memberInputToRow(cellId, input);
    await this.writeMemberRow(row);
    await this.bumpCellVersion(cellId);
    return { ok: true, member: memberRowToRecord(row) };
  }

  async updateMember(
    cellId: string,
    endpointId: string,
    patch: Partial<UpsertCollaborationMemberInput>,
  ): Promise<{ ok: true; member: CollaborationCellMemberRecord } | { ok: false; error: string }> {
    const existing = await this.getMemberRow(cellId, endpointId);
    if (!existing) return { ok: false, error: `Member ${endpointId} not found` };
    const row = memberInputToRow(cellId, {
      endpointId,
      primary: patch.primary ?? existing.primary,
      role: patch.role ?? (existing.role || undefined),
      pipelineRole: patch.pipelineRole ?? (existing.pipeline_role || undefined),
      sortOrder: patch.sortOrder ?? existing.sort_order,
      enabled: patch.enabled,
    }, Date.now(), existing);
    await this.writeMemberRow(row);
    await this.bumpCellVersion(cellId);
    return { ok: true, member: memberRowToRecord(row) };
  }

  async removeMember(cellId: string, endpointId: string): Promise<boolean> {
    const ok = await this.deleteMemberRow(cellId, endpointId);
    if (ok) await this.bumpCellVersion(cellId);
    return ok;
  }

  private async bumpCellVersion(cellId: string): Promise<void> {
    const cell = await this.getCellRecord(cellId);
    if (!cell) return;
    await this.writeCellRecord({
      ...cell,
      version: cell.version + 1,
      updated_at: Date.now(),
    });
  }
}

export class MemoryCollaborationCellRepository extends CollaborationCellRepositoryBase {
  private cells = new Map<string, CollaborationCellRecord>();
  private members = new Map<string, CollaborationCellMemberRow[]>();

  protected async getCellRecord(id: string): Promise<CollaborationCellRecord | null> {
    return this.cells.get(id) ?? null;
  }

  protected async listCellRecords(enabledOnly = false): Promise<CollaborationCellRecord[]> {
    return [...this.cells.values()].filter((r) => !enabledOnly || r.enabled !== 0);
  }

  protected async findCellRecordByScene(adapter: string, sceneId: string): Promise<CollaborationCellRecord | null> {
    for (const row of this.cells.values()) {
      if (row.enabled !== 0 && row.adapter === adapter && row.scene_id === sceneId) return row;
    }
    return null;
  }

  protected async writeCellRecord(record: CollaborationCellRecord): Promise<void> {
    this.cells.set(record.id, record);
  }

  protected async deleteCellRecord(id: string): Promise<boolean> {
    return this.cells.delete(id);
  }

  protected async listMemberRows(cellId: string): Promise<CollaborationCellMemberRow[]> {
    return [...(this.members.get(cellId) ?? [])];
  }

  protected async listMemberRowsByEndpoint(endpointId: string): Promise<CollaborationCellMemberRow[]> {
    const out: CollaborationCellMemberRow[] = [];
    for (const rows of this.members.values()) {
      for (const row of rows) {
        if (row.endpoint_id === endpointId) out.push(row);
      }
    }
    return out;
  }

  protected async getMemberRow(cellId: string, endpointId: string): Promise<CollaborationCellMemberRow | null> {
    return (this.members.get(cellId) ?? []).find((m) => m.endpoint_id === endpointId) ?? null;
  }

  protected async writeMemberRow(row: CollaborationCellMemberRow): Promise<void> {
    const list = [...(this.members.get(row.cell_id) ?? [])];
    const idx = list.findIndex((m) => m.endpoint_id === row.endpoint_id);
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    list.sort((a, b) => a.sort_order - b.sort_order || a.endpoint_id.localeCompare(b.endpoint_id));
    this.members.set(row.cell_id, list);
  }

  protected async deleteMemberRow(cellId: string, endpointId: string): Promise<boolean> {
    const list = this.members.get(cellId);
    if (!list) return false;
    const next = list.filter((m) => m.endpoint_id !== endpointId);
    if (next.length === list.length) return false;
    this.members.set(cellId, next);
    return true;
  }

  protected async deleteMembersForCell(cellId: string): Promise<void> {
    this.members.delete(cellId);
  }

  protected async replaceMembers(cellId: string, members: CollaborationCellMemberRecord[]): Promise<void> {
    const now = Date.now();
    const rows = members.map((m, i) => memberInputToRow(cellId, { ...m, sortOrder: m.sortOrder ?? i }));
    for (const row of rows) {
      row.created_at = (await this.getMemberRow(cellId, row.endpoint_id))?.created_at ?? now;
    }
    this.members.set(cellId, rows);
  }
}

export class DatabaseCollaborationCellRepository extends CollaborationCellRepositoryBase {
  constructor(
    private readonly cellModel: DbModel,
    private readonly memberModel: DbModel,
  ) {
    super();
  }

  protected async getCellRecord(id: string): Promise<CollaborationCellRecord | null> {
    const rows = await this.cellModel.select().where({ id });
    if (!rows.length) return null;
    return rowToCellRecord(rows[0]!);
  }

  protected async listCellRecords(enabledOnly = false): Promise<CollaborationCellRecord[]> {
    const rows = await this.cellModel.select().where(enabledOnly ? { enabled: 1 } : {});
    return rows.map(rowToCellRecord);
  }

  protected async findCellRecordByScene(adapter: string, sceneId: string): Promise<CollaborationCellRecord | null> {
    const rows = await this.cellModel.select().where({ adapter, scene_id: sceneId, enabled: 1 });
    if (!rows.length) return null;
    return rowToCellRecord(rows[0]!);
  }

  protected async writeCellRecord(record: CollaborationCellRecord): Promise<void> {
    const existing = await this.getCellRecord(record.id);
    if (!existing) {
      await this.cellModel.create({ ...record });
      return;
    }
    await this.cellModel.update({ ...record }).where({ id: record.id });
  }

  protected async deleteCellRecord(id: string): Promise<boolean> {
    if (!this.cellModel.delete) return false;
    const existing = await this.getCellRecord(id);
    if (!existing) return false;
    await this.cellModel.delete().where({ id });
    return true;
  }

  protected async listMemberRows(cellId: string): Promise<CollaborationCellMemberRow[]> {
    const rows = await this.memberModel.select().where({ cell_id: cellId });
    return rows.map(rowToMemberRow).sort((a, b) => a.sort_order - b.sort_order);
  }

  protected async listMemberRowsByEndpoint(endpointId: string): Promise<CollaborationCellMemberRow[]> {
    const rows = await this.memberModel.select().where({ endpoint_id: endpointId, enabled: 1 });
    return rows.map(rowToMemberRow);
  }

  protected async getMemberRow(cellId: string, endpointId: string): Promise<CollaborationCellMemberRow | null> {
    const rows = await this.memberModel.select().where({ cell_id: cellId, endpoint_id: endpointId });
    if (!rows.length) return null;
    return rowToMemberRow(rows[0]!);
  }

  protected async writeMemberRow(row: CollaborationCellMemberRow): Promise<void> {
    const existing = await this.getMemberRow(row.cell_id, row.endpoint_id);
    if (!existing) {
      await this.memberModel.create({ ...row });
      return;
    }
    await this.memberModel.update({ ...row }).where({ cell_id: row.cell_id, endpoint_id: row.endpoint_id });
  }

  protected async deleteMemberRow(cellId: string, endpointId: string): Promise<boolean> {
    if (!this.memberModel.delete) return false;
    const existing = await this.getMemberRow(cellId, endpointId);
    if (!existing) return false;
    await this.memberModel.delete().where({ cell_id: cellId, endpoint_id: endpointId });
    return true;
  }

  protected async deleteMembersForCell(cellId: string): Promise<void> {
    if (!this.memberModel.delete) return;
    const rows = await this.listMemberRows(cellId);
    for (const row of rows) {
      await this.memberModel.delete().where({ cell_id: cellId, endpoint_id: row.endpoint_id });
    }
  }

  protected async replaceMembers(cellId: string, members: CollaborationCellMemberRecord[]): Promise<void> {
    const existing = await this.listMemberRows(cellId);
    const nextIds = new Set(members.map((m) => m.endpointId));
    for (const row of existing) {
      if (!nextIds.has(row.endpoint_id)) {
        await this.deleteMemberRow(cellId, row.endpoint_id);
      }
    }
    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      const prev = existing.find((r) => r.endpoint_id === m.endpointId);
      await this.writeMemberRow(memberInputToRow(cellId, { ...m, sortOrder: m.sortOrder ?? i }, Date.now(), prev));
    }
  }
}

let globalRepository: CollaborationCellRepository | null = null;

export function getCollaborationCellRepository(): CollaborationCellRepository {
  if (!globalRepository) {
    globalRepository = new MemoryCollaborationCellRepository();
  }
  return globalRepository;
}

export function setCollaborationCellRepository(repo: CollaborationCellRepository | null): void {
  globalRepository = repo;
}

export function createCollaborationCellRepository(
  cellModel?: DbModel,
  memberModel?: DbModel,
): CollaborationCellRepository {
  if (cellModel && memberModel) {
    return new DatabaseCollaborationCellRepository(cellModel, memberModel);
  }
  return new MemoryCollaborationCellRepository();
}
