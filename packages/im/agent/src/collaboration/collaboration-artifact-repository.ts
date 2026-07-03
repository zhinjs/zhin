/**
 * CollaborationArtifactRepository — pipeline 阶段产物持久化（ADR 0024 D4）。
 *
 * Artifact 是跨角色数据的唯一通道；Reviewer 记忆切片只读取白名单 kind。
 */
import { randomUUID } from 'node:crypto';
import type { PipelineArtifact, PipelineArtifactKind, PipelineStage } from './types.js';
import type { CollaborationCellArtifactRow } from './collaboration-db-model.js';

export interface SubmitArtifactInput {
  cellId: string;
  runId: string;
  stage: PipelineStage;
  kind: PipelineArtifactKind;
  payload: Record<string, unknown>;
  createdByEndpoint?: string;
}

export interface CollaborationArtifactRepository {
  submit(input: SubmitArtifactInput): Promise<PipelineArtifact>;
  /** 列出某 run 的产物，可选按 kind 过滤。 */
  listByRun(cellId: string, runId: string, kinds?: PipelineArtifactKind[]): Promise<PipelineArtifact[]>;
  /** 取某 run + kind 的最新一条。 */
  latest(cellId: string, runId: string, kind: PipelineArtifactKind): Promise<PipelineArtifact | null>;
  deleteByCell(cellId: string): Promise<void>;
}

type DbModel = {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
  delete?(): { where(condition: Record<string, unknown>): Promise<unknown> };
};

function rowToArtifact(row: CollaborationCellArtifactRow): PipelineArtifact {
  let payload: Record<string, unknown> = {};
  try {
    payload = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
  } catch {
    payload = { _raw: row.payload };
  }
  return {
    id: row.id,
    cellId: row.cell_id,
    runId: row.run_id,
    stage: row.stage as PipelineStage,
    kind: row.kind as PipelineArtifactKind,
    payload,
    createdByEndpoint: row.created_by_endpoint || undefined,
    createdAt: row.created_at,
  };
}

function buildRow(input: SubmitArtifactInput): CollaborationCellArtifactRow {
  return {
    id: randomUUID(),
    cell_id: input.cellId,
    run_id: input.runId,
    stage: input.stage,
    kind: input.kind,
    payload: JSON.stringify(input.payload ?? {}),
    created_by_endpoint: input.createdByEndpoint ?? '',
    created_at: Date.now(),
  };
}

function applyFilter(
  rows: PipelineArtifact[],
  runId: string,
  kinds?: PipelineArtifactKind[],
): PipelineArtifact[] {
  return rows
    .filter((a) => a.runId === runId && (!kinds?.length || kinds.includes(a.kind)))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export class MemoryCollaborationArtifactRepository implements CollaborationArtifactRepository {
  private byCell = new Map<string, PipelineArtifact[]>();

  async submit(input: SubmitArtifactInput): Promise<PipelineArtifact> {
    const artifact = rowToArtifact(buildRow(input));
    const list = this.byCell.get(input.cellId) ?? [];
    list.push(artifact);
    this.byCell.set(input.cellId, list);
    return artifact;
  }

  async listByRun(cellId: string, runId: string, kinds?: PipelineArtifactKind[]): Promise<PipelineArtifact[]> {
    return applyFilter(this.byCell.get(cellId) ?? [], runId, kinds);
  }

  async latest(cellId: string, runId: string, kind: PipelineArtifactKind): Promise<PipelineArtifact | null> {
    const list = applyFilter(this.byCell.get(cellId) ?? [], runId, [kind]);
    return list.length ? list[list.length - 1]! : null;
  }

  async deleteByCell(cellId: string): Promise<void> {
    this.byCell.delete(cellId);
  }
}

export class DatabaseCollaborationArtifactRepository implements CollaborationArtifactRepository {
  constructor(private readonly model: DbModel) {}

  async submit(input: SubmitArtifactInput): Promise<PipelineArtifact> {
    const row = buildRow(input);
    await this.model.create({ ...row });
    return rowToArtifact(row);
  }

  async listByRun(cellId: string, runId: string, kinds?: PipelineArtifactKind[]): Promise<PipelineArtifact[]> {
    const rows = await this.model.select().where({ cell_id: cellId, run_id: runId });
    const artifacts = rows.map((r) => rowToArtifact(r as unknown as CollaborationCellArtifactRow));
    return applyFilter(artifacts, runId, kinds);
  }

  async latest(cellId: string, runId: string, kind: PipelineArtifactKind): Promise<PipelineArtifact | null> {
    const list = await this.listByRun(cellId, runId, [kind]);
    return list.length ? list[list.length - 1]! : null;
  }

  async deleteByCell(cellId: string): Promise<void> {
    if (!this.model.delete) return;
    await this.model.delete().where({ cell_id: cellId });
  }
}

let globalArtifactRepo: CollaborationArtifactRepository | null = null;

export function getCollaborationArtifactRepository(): CollaborationArtifactRepository {
  if (!globalArtifactRepo) globalArtifactRepo = new MemoryCollaborationArtifactRepository();
  return globalArtifactRepo;
}

export function setCollaborationArtifactRepository(repo: CollaborationArtifactRepository | null): void {
  globalArtifactRepo = repo;
}

export function createCollaborationArtifactRepository(model?: DbModel): CollaborationArtifactRepository {
  if (model) return new DatabaseCollaborationArtifactRepository(model);
  return new MemoryCollaborationArtifactRepository();
}
