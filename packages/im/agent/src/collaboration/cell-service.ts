/**
 * CollaborationCellService — repository-backed GroupCell access with memory cache.
 */

import type { CollaborationCell } from './types.js';
import {
  getCollaborationCellRepository,
  type CollaborationCellRepository,
  type UpsertCollaborationCellInput,
} from './collaboration-cell-repository.js';

export interface CellStoreSnapshot {
  id: string;
  adapter: string;
  sceneId: string;
  goal?: string;
  missionRunId?: string;
  members: CollaborationCell['members'];
  version: number;
}

export class CollaborationCellService {
  private cache = new Map<string, CollaborationCell>();
  private repository: CollaborationCellRepository;

  constructor(repository?: CollaborationCellRepository) {
    this.repository = repository ?? getCollaborationCellRepository();
  }

  setRepository(repository: CollaborationCellRepository): void {
    this.repository = repository;
    this.cache.clear();
  }

  /** 从数据库重载（启动后或 REST / /collab 变更后可调用） */
  async reloadFromRepository(): Promise<CollaborationCell[]> {
    const cells = await this.repository.listEnabled();
    this.cache.clear();
    for (const cell of cells) {
      this.cache.set(cell.id, cell);
    }
    return cells;
  }

  listCells(): CollaborationCell[] {
    return [...this.cache.values()];
  }

  getCell(id: string): CollaborationCell | undefined {
    return this.cache.get(id);
  }

  findByScene(adapter: string, sceneId: string): CollaborationCell | undefined {
    const ad = String(adapter);
    const sid = String(sceneId);
    return [...this.cache.values()].find(
      (c) => c.adapter === ad && String(c.sceneId) === sid,
    );
  }

  async getCellFresh(id: string): Promise<CollaborationCell | null> {
    const cell = await this.repository.getById(id);
    if (cell) this.cache.set(id, cell);
    return cell;
  }

  async upsertCell(input: UpsertCollaborationCellInput): Promise<CollaborationCell> {
    const cell = await this.repository.upsert(input);
    this.cache.set(cell.id, cell);
    return cell;
  }

  async setGoal(cellId: string, goal: string, expectedVersion?: number): Promise<{ ok: boolean; error?: string }> {
    const result = await this.repository.updateGoal(cellId, goal, expectedVersion);
    if (!result.ok) return result;
    this.cache.set(cellId, result.cell);
    return { ok: true };
  }

  getMissionStatus(cellId: string): { goal?: string; missionRunId?: string; version?: number } | undefined {
    const cell = this.getCell(cellId);
    if (!cell) return undefined;
    return {
      goal: cell.goal,
      missionRunId: cell.missionRunId,
      version: cell.version,
    };
  }

  async setMissionRunId(cellId: string, missionRunId: string): Promise<void> {
    await this.repository.setMissionRunId(cellId, missionRunId);
    const cell = await this.repository.getById(cellId);
    if (cell) this.cache.set(cellId, cell);
  }

  async setPipelineState(cellId: string, state: import('./types.js').PipelineState): Promise<void> {
    await this.repository.setPipelineState(cellId, state);
    const cell = await this.repository.getById(cellId);
    if (cell) this.cache.set(cellId, cell);
  }

  async patchPipelineState(
    cellId: string,
    patch: (
      prev: import('./types.js').PipelineState | undefined,
      cell: CollaborationCell,
    ) => import('./types.js').PipelineState | undefined,
    maxRetries?: number,
  ): Promise<
    { ok: true; cell: CollaborationCell } | { ok: false; error: string; conflict?: boolean }
  > {
    const result = await this.repository.patchPipelineState(cellId, patch, maxRetries);
    if (result.ok) this.cache.set(cellId, result.cell);
    return result;
  }

  async deleteCell(cellId: string): Promise<boolean> {
    const ok = await this.repository.delete(cellId);
    if (ok) this.cache.delete(cellId);
    return ok;
  }

  async listMembers(cellId: string): Promise<import('./collaboration-db-model.js').CollaborationCellMemberRecord[]> {
    return this.repository.listMembers(cellId);
  }

  async findCellsByEndpoint(endpointId: string): Promise<CollaborationCell[]> {
    const cells = await this.repository.findCellsByEndpoint(endpointId);
    for (const cell of cells) this.cache.set(cell.id, cell);
    return cells;
  }

  async addMember(
    cellId: string,
    input: import('./collaboration-db-model.js').UpsertCollaborationMemberInput,
  ): Promise<{ ok: boolean; member?: import('./collaboration-db-model.js').CollaborationCellMemberRecord; error?: string }> {
    const result = await this.repository.addMember(cellId, input);
    if (!result.ok) return result;
    const cell = await this.repository.getById(cellId);
    if (cell) this.cache.set(cellId, cell);
    return { ok: true, member: result.member };
  }

  async updateMember(
    cellId: string,
    endpointId: string,
    patch: Partial<import('./collaboration-db-model.js').UpsertCollaborationMemberInput>,
  ): Promise<{ ok: boolean; member?: import('./collaboration-db-model.js').CollaborationCellMemberRecord; error?: string }> {
    const result = await this.repository.updateMember(cellId, endpointId, patch);
    if (!result.ok) return result;
    const cell = await this.repository.getById(cellId);
    if (cell) this.cache.set(cellId, cell);
    return { ok: true, member: result.member };
  }

  async removeMember(cellId: string, endpointId: string): Promise<boolean> {
    const ok = await this.repository.removeMember(cellId, endpointId);
    if (ok) {
      const cell = await this.repository.getById(cellId);
      if (cell) this.cache.set(cellId, cell);
      else this.cache.delete(cellId);
    }
    return ok;
  }

  toSnapshot(cell: CollaborationCell): CellStoreSnapshot {
    return {
      id: cell.id,
      adapter: cell.adapter,
      sceneId: cell.sceneId,
      goal: cell.goal,
      missionRunId: cell.missionRunId,
      members: cell.members,
      version: cell.version ?? 0,
    };
  }
}

let globalCellService: CollaborationCellService | null = null;

export function getCollaborationCellService(): CollaborationCellService {
  if (!globalCellService) {
    globalCellService = new CollaborationCellService();
  }
  return globalCellService;
}

export async function initCollaborationCellService(): Promise<CollaborationCellService> {
  const svc = getCollaborationCellService();
  await svc.reloadFromRepository();
  return svc;
}

export function resetCollaborationCellService(): void {
  globalCellService = null;
}
