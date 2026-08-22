import { createHash } from 'node:crypto';
import {
  ProjectKnowledgeRevisionConflictError,
  replayProjectKnowledge,
  type ProjectKnowledgeEvent,
  type ProjectKnowledgeJournal,
} from './project-knowledge-registry.js';
import { canonicalWorkroomJson } from './canonical-value.js';

export interface ProjectKnowledgeDatabaseModel {
  select(...fields: string[]): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
}

export interface ProjectKnowledgeDatabaseTransaction {
  select(table: string): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
}

export interface ProjectKnowledgeDatabase {
  transaction<T>(
    operation: (transaction: ProjectKnowledgeDatabaseTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

/** Publishes no writer until every requested Project has migrated and reread exactly. */
export class ActivatableProjectKnowledgeJournal implements ProjectKnowledgeJournal {
  #delegate?: ProjectKnowledgeJournal;

  async activate(
    delegate: ProjectKnowledgeJournal,
    projectIds: readonly string[],
    source?: ProjectKnowledgeJournal,
  ): Promise<void> {
    if (this.#delegate) throw new Error('Project Knowledge storage is already active');
    const ids = canonicalIds(projectIds);
    for (const projectId of ids) {
      const sourceEvents = source ? await source.read(projectId) : Object.freeze([]);
      let targetEvents = await delegate.read(projectId);
      replayProjectKnowledge(projectId, sourceEvents);
      replayProjectKnowledge(projectId, targetEvents);
      assertSharedPrefix(sourceEvents, targetEvents);
      for (const event of sourceEvents.slice(targetEvents.length)) {
        await delegate.append(projectId, event.revision - 1, event);
      }
      targetEvents = await delegate.read(projectId);
      if (targetEvents.length < sourceEvents.length) {
        throw new Error('Project Knowledge target did not durably replay the File source');
      }
      assertSharedPrefix(sourceEvents, targetEvents);
    }
    if (this.#delegate) throw new Error('Project Knowledge storage is already active');
    this.#delegate = delegate;
  }

  read(projectId: string): Promise<readonly ProjectKnowledgeEvent[]> {
    return this.#require().read(projectId);
  }

  append(projectId: string, expectedRevision: number, event: ProjectKnowledgeEvent): Promise<ProjectKnowledgeEvent> {
    return this.#require().append(projectId, expectedRevision, event);
  }

  #require(): ProjectKnowledgeJournal {
    if (!this.#delegate) throw new Error('Project Knowledge storage is not active');
    return this.#delegate;
  }
}

export class DatabaseProjectKnowledgeJournal implements ProjectKnowledgeJournal {
  constructor(
    readonly database: ProjectKnowledgeDatabase,
    readonly model: ProjectKnowledgeDatabaseModel,
  ) {}

  async read(projectId: string): Promise<readonly ProjectKnowledgeEvent[]> {
    const id = required(projectId, 'projectId');
    return parseRows(id, await this.model.select().where({ project_id: id }));
  }

  async append(
    projectId: string,
    expectedRevision: number,
    event: ProjectKnowledgeEvent,
  ): Promise<ProjectKnowledgeEvent> {
    const id = required(projectId, 'projectId');
    if (event.projectId !== id || event.revision !== expectedRevision + 1) {
      throw new Error('Project Knowledge database append scope drift');
    }
    try {
      return await this.database.transaction(async transaction => {
        const current = parseRows(id, await transaction.select('workroom_project_knowledge')
          .where({ project_id: id }));
        const replay = current.find(value => value.operationId === event.operationId);
        if (replay) {
          if (replay.commandDigest !== event.commandDigest) throw new Error('Project Knowledge operation identity drift');
          return replay;
        }
        const actual = current.at(-1)?.revision ?? -1;
        if (actual !== expectedRevision) throw new ProjectKnowledgeRevisionConflictError(id, expectedRevision, actual);
        replayProjectKnowledge(id, [...current, event]);
        await transaction.insertMany('workroom_project_knowledge', [toRow(event)]);
        return event;
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (error instanceof ProjectKnowledgeRevisionConflictError) throw error;
      const winner = await this.read(id);
      const replay = winner.find(value => value.operationId === event.operationId);
      if (replay && replay.commandDigest === event.commandDigest) return replay;
      const occupied = winner[event.revision];
      if (occupied && canonicalWorkroomJson(occupied) === canonicalWorkroomJson(event)) return occupied;
      const actual = winner.at(-1)?.revision ?? -1;
      if (actual !== expectedRevision) throw new ProjectKnowledgeRevisionConflictError(id, expectedRevision, actual);
      throw error;
    }
  }
}

export const WORKROOM_PROJECT_KNOWLEDGE_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  project_id: { type: 'text' as const, nullable: false },
  revision: { type: 'integer' as const, nullable: false },
  operation_id: { type: 'text' as const, nullable: false },
  event_digest: { type: 'text' as const, nullable: false },
  event_json: { type: 'text' as const, nullable: false },
};

export function defineProjectKnowledgeDatabaseModel(
  database: Readonly<{ define(name: string, definition: unknown): void }>,
): void {
  database.define('workroom_project_knowledge', WORKROOM_PROJECT_KNOWLEDGE_MODEL);
}

function parseRows(projectId: string, rows: readonly Record<string, unknown>[]): readonly ProjectKnowledgeEvent[] {
  const sorted = [...rows].sort((left, right) => integer(left.revision) - integer(right.revision));
  const events = sorted.map((row, revision) => {
    exactRow(row);
    if (row.project_id !== projectId || integer(row.revision) !== revision || typeof row.event_json !== 'string') {
      throw new Error('Project Knowledge database row binding drift');
    }
    const event = JSON.parse(row.event_json) as ProjectKnowledgeEvent;
    if (event.revision !== revision || row.operation_id !== event.operationId || row.event_digest !== event.digest
      || canonicalWorkroomJson(event) !== row.event_json) {
      throw new Error('Project Knowledge database event drift');
    }
    return event;
  });
  replayProjectKnowledge(projectId, events);
  return Object.freeze(events);
}

function toRow(event: ProjectKnowledgeEvent): Record<string, unknown> {
  return {
    id: `${createHash('sha256').update(event.projectId).digest('hex')}:${event.revision}`,
    project_id: event.projectId,
    revision: event.revision,
    operation_id: event.operationId,
    event_digest: event.digest,
    event_json: canonicalWorkroomJson(event),
  };
}

function exactRow(row: Record<string, unknown>): void {
  const keys = ['id', 'project_id', 'revision', 'operation_id', 'event_digest', 'event_json'];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) {
    throw new Error('Project Knowledge database row exact schema drift');
  }
}

function canonicalIds(values: readonly string[]): readonly string[] {
  const ids = values.map(value => required(value, 'projectId')).sort();
  if (new Set(ids).size !== ids.length) throw new Error('Project Knowledge activation contains duplicate Project ids');
  return ids;
}

function assertSharedPrefix(
  source: readonly ProjectKnowledgeEvent[],
  target: readonly ProjectKnowledgeEvent[],
): void {
  const shared = Math.min(source.length, target.length);
  for (let index = 0; index < shared; index += 1) {
    if (canonicalWorkroomJson(source[index]) !== canonicalWorkroomJson(target[index])) {
      throw new Error('Project Knowledge File/Database handoff diverged');
    }
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('revision is invalid');
  return Number(value);
}
