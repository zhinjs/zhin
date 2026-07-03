/**
 * CollaborationSceneService — repository-backed GroupCell access with memory cache.
 */

import type { CollaborationScene } from './types.js';
import {
  getCollaborationSceneRepository,
  type CollaborationSceneRepository,
  type UpsertCollaborationSceneInput,
} from './collaboration-scene-repository.js';

export interface SceneStoreSnapshot {
  id: string;
  adapter: string;
  sceneId: string;
  goal?: string;
  missionRunId?: string;
  members: CollaborationScene['members'];
  version: number;
}

export class CollaborationSceneService {
  private cache = new Map<string, CollaborationScene>();
  private repository: CollaborationSceneRepository;

  constructor(repository?: CollaborationSceneRepository) {
    this.repository = repository ?? getCollaborationSceneRepository();
  }

  setRepository(repository: CollaborationSceneRepository): void {
    this.repository = repository;
    this.cache.clear();
  }

  /** 从数据库重载（启动后或 REST / /collab 变更后可调用） */
  async reloadFromRepository(): Promise<CollaborationScene[]> {
    const cells = await this.repository.listEnabled();
    this.cache.clear();
    for (const cell of cells) {
      this.cache.set(cell.id, cell);
    }
    return cells;
  }

  listScenes(): CollaborationScene[] {
    return [...this.cache.values()];
  }

  getScene(id: string): CollaborationScene | undefined {
    return this.cache.get(id);
  }

  findByScene(adapter: string, sceneId: string): CollaborationScene | undefined {
    const ad = String(adapter);
    const sid = String(sceneId);
    return [...this.cache.values()].find(
      (c) => c.adapter === ad && String(c.sceneId) === sid,
    );
  }

  async getSceneFresh(id: string): Promise<CollaborationScene | null> {
    const cell = await this.repository.getById(id);
    if (cell) this.cache.set(id, cell);
    return cell;
  }

  async upsertScene(input: UpsertCollaborationSceneInput): Promise<CollaborationScene> {
    const cell = await this.repository.upsert(input);
    this.cache.set(cell.id, cell);
    return cell;
  }

  async setGoal(collaborationSceneId: string, goal: string, expectedVersion?: number): Promise<{ ok: boolean; error?: string }> {
    const result = await this.repository.updateGoal(collaborationSceneId, goal, expectedVersion);
    if (!result.ok) return result;
    this.cache.set(collaborationSceneId, result.scene);
    return { ok: true };
  }

  getMissionStatus(collaborationSceneId: string): { goal?: string; missionRunId?: string; version?: number } | undefined {
    const cell = this.getScene(collaborationSceneId);
    if (!cell) return undefined;
    return {
      goal: cell.goal,
      missionRunId: cell.missionRunId,
      version: cell.version,
    };
  }

  async setMissionRunId(collaborationSceneId: string, missionRunId: string): Promise<void> {
    await this.repository.setMissionRunId(collaborationSceneId, missionRunId);
    const cell = await this.repository.getById(collaborationSceneId);
    if (cell) this.cache.set(collaborationSceneId, cell);
  }

  async setPipelineState(collaborationSceneId: string, state: import('./types.js').PipelineState): Promise<void> {
    await this.repository.setPipelineState(collaborationSceneId, state);
    const cell = await this.repository.getById(collaborationSceneId);
    if (cell) this.cache.set(collaborationSceneId, cell);
  }

  async patchPipelineState(
    collaborationSceneId: string,
    patch: (
      prev: import('./types.js').PipelineState | undefined,
      cell: CollaborationScene,
    ) => import('./types.js').PipelineState | undefined,
    maxRetries?: number,
  ): Promise<
    { ok: true; scene: CollaborationScene } | { ok: false; error: string; conflict?: boolean }
  > {
    const result = await this.repository.patchPipelineState(collaborationSceneId, patch, maxRetries);
    if (result.ok) this.cache.set(collaborationSceneId, result.scene);
    return result;
  }

  async deleteScene(collaborationSceneId: string): Promise<boolean> {
    const ok = await this.repository.delete(collaborationSceneId);
    if (ok) this.cache.delete(collaborationSceneId);
    return ok;
  }

  async listMembers(collaborationSceneId: string): Promise<import('./collaboration-db-model.js').CollaborationSceneMemberRecord[]> {
    return this.repository.listMembers(collaborationSceneId);
  }

  async findScenesByEndpoint(endpointId: string): Promise<CollaborationScene[]> {
    const cells = await this.repository.findScenesByEndpoint(endpointId);
    for (const cell of cells) this.cache.set(cell.id, cell);
    return cells;
  }

  async addMember(
    collaborationSceneId: string,
    input: import('./collaboration-db-model.js').UpsertCollaborationMemberInput,
  ): Promise<{ ok: boolean; member?: import('./collaboration-db-model.js').CollaborationSceneMemberRecord; error?: string }> {
    const result = await this.repository.addMember(collaborationSceneId, input);
    if (!result.ok) return result;
    const cell = await this.repository.getById(collaborationSceneId);
    if (cell) this.cache.set(collaborationSceneId, cell);
    return { ok: true, member: result.member };
  }

  async updateMember(
    collaborationSceneId: string,
    endpointId: string,
    patch: Partial<import('./collaboration-db-model.js').UpsertCollaborationMemberInput>,
  ): Promise<{ ok: boolean; member?: import('./collaboration-db-model.js').CollaborationSceneMemberRecord; error?: string }> {
    const result = await this.repository.updateMember(collaborationSceneId, endpointId, patch);
    if (!result.ok) return result;
    const cell = await this.repository.getById(collaborationSceneId);
    if (cell) this.cache.set(collaborationSceneId, cell);
    return { ok: true, member: result.member };
  }

  async removeMember(collaborationSceneId: string, endpointId: string): Promise<boolean> {
    const ok = await this.repository.removeMember(collaborationSceneId, endpointId);
    if (ok) {
      const cell = await this.repository.getById(collaborationSceneId);
      if (cell) this.cache.set(collaborationSceneId, cell);
      else this.cache.delete(collaborationSceneId);
    }
    return ok;
  }

  toSnapshot(cell: CollaborationScene): SceneStoreSnapshot {
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

let globalSceneService: CollaborationSceneService | null = null;

export function getCollaborationSceneService(): CollaborationSceneService {
  if (!globalSceneService) {
    globalSceneService = new CollaborationSceneService();
  }
  return globalSceneService;
}

export async function initCollaborationSceneService(): Promise<CollaborationSceneService> {
  const svc = getCollaborationSceneService();
  await svc.reloadFromRepository();
  return svc;
}

export function resetCollaborationSceneService(): void {
  globalSceneService = null;
}
