import { createHash } from 'node:crypto';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import {
  replayPayloadLifecycle,
  type PayloadLifecycleEvent,
  type PayloadLifecycleEventDraft,
  type PayloadLifecycleJournal,
} from './payload-lifecycle.js';
import { PayloadLifecycleSequenceConflictError } from './file-payload-lifecycle-repository.js';

export interface PayloadLifecycleDatabaseModel {
  select(...fields: string[]): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
}

export interface PayloadLifecycleDatabaseTransaction {
  select(table: string): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
}

export interface PayloadLifecycleDatabase {
  transaction<T>(
    operation: (transaction: PayloadLifecycleDatabaseTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

/**
 * Candidate-owned storage latch. File events are exact content-free facts, so
 * they can be copied without rematerializing Payload handles or body data.
 */
export class ActivatablePayloadLifecycleRepository implements PayloadLifecycleJournal {
  #delegate?: PayloadLifecycleJournal;

  async activate(
    delegate: PayloadLifecycleJournal,
    projectIds: readonly string[],
    source?: PayloadLifecycleJournal,
  ): Promise<void> {
    if (this.#delegate) throw new Error('Payload Lifecycle storage is already active');
    const projects = [...new Set(projectIds.map(projectId => required(projectId, 'projectId')))].sort();
    if (projects.length !== projectIds.length) {
      throw new Error('Payload Lifecycle activation contains duplicate Project ids');
    }
    for (const projectId of projects) {
      const sourceIds = source ? await source.listObjectIds(projectId) : Object.freeze([]);
      for (const objectId of sourceIds) {
        const sourceEvents = await source!.read(projectId, objectId);
        let targetEvents = await delegate.read(projectId, objectId);
        assertPrefix(projectId, objectId, sourceEvents, targetEvents);
        if (targetEvents.length < sourceEvents.length) {
          await delegate.append(
            projectId,
            objectId,
            targetEvents.length - 1,
            sourceEvents.slice(targetEvents.length).map(toDraft),
          );
          targetEvents = await delegate.read(projectId, objectId);
        }
        assertPrefix(projectId, objectId, sourceEvents, targetEvents);
        if (targetEvents.length < sourceEvents.length) {
          throw new Error('Payload Lifecycle Database target did not durably replay the File source');
        }
      }
    }
    if (this.#delegate) throw new Error('Payload Lifecycle storage is already active');
    this.#delegate = delegate;
  }

  read(projectId: string, objectId: string): Promise<readonly PayloadLifecycleEvent[]> {
    return this.#require().read(projectId, objectId);
  }

  append(
    projectId: string,
    objectId: string,
    expectedSequence: number,
    drafts: readonly PayloadLifecycleEventDraft[],
  ): Promise<readonly PayloadLifecycleEvent[]> {
    return this.#require().append(projectId, objectId, expectedSequence, drafts);
  }

  listObjectIds(projectId: string): Promise<readonly string[]> {
    return this.#require().listObjectIds(projectId);
  }

  #require(): PayloadLifecycleJournal {
    if (!this.#delegate) throw new Error('Payload Lifecycle storage is not active');
    return this.#delegate;
  }
}

/** Database-backed content-free Lifecycle Journal with SERIALIZABLE append CAS. */
export class DatabasePayloadLifecycleRepository implements PayloadLifecycleJournal {
  constructor(
    readonly database: PayloadLifecycleDatabase,
    readonly model: PayloadLifecycleDatabaseModel,
  ) {}

  async read(projectId: string, objectId: string): Promise<readonly PayloadLifecycleEvent[]> {
    const project = required(projectId, 'projectId');
    const object = required(objectId, 'objectId');
    return parseRows(project, object, await this.model.select().where({
      project_id: project,
      object_id: object,
    }));
  }

  async append(
    projectId: string,
    objectId: string,
    expectedSequence: number,
    drafts: readonly PayloadLifecycleEventDraft[],
  ): Promise<readonly PayloadLifecycleEvent[]> {
    const project = required(projectId, 'projectId');
    const object = required(objectId, 'objectId');
    sequence(expectedSequence, 'expectedSequence', -1);
    if (!Array.isArray(drafts) || drafts.length === 0) return Object.freeze([]);
    const snapshot = deepFreeze(structuredClone(drafts));
    try {
      return await this.database.transaction(async transaction => {
        const current = parseRows(project, object, await transaction
          .select('payload_lifecycle_events')
          .where({ project_id: project, object_id: object }));
        const replay = exactReplay(current, expectedSequence, snapshot);
        if (replay) return replay;
        const actual = current.at(-1)?.sequence ?? -1;
        if (actual !== expectedSequence) {
          throw new PayloadLifecycleSequenceConflictError(project, object, expectedSequence, actual);
        }
        const events = materialize(project, object, expectedSequence, snapshot);
        replayPayloadLifecycle(project, object, deepFreeze([...current, ...events]));
        await transaction.insertMany('payload_lifecycle_events', events.map(toRow));
        return events;
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (error instanceof PayloadLifecycleSequenceConflictError || !isDatabaseCasLoser(error)) throw error;
      const winner = await this.read(project, object);
      const replay = exactReplay(winner, expectedSequence, snapshot);
      if (replay) return replay;
      throw new PayloadLifecycleSequenceConflictError(
        project,
        object,
        expectedSequence,
        winner.at(-1)?.sequence ?? -1,
      );
    }
  }

  async listObjectIds(projectId: string): Promise<readonly string[]> {
    const project = required(projectId, 'projectId');
    const rows = await this.model.select().where({ project_id: project });
    const objectIds = new Set<string>();
    for (const row of rows) {
      exactRow(row);
      if (row.project_id !== project) throw new Error('Payload Lifecycle database Project row drift');
      objectIds.add(required(row.object_id, 'row.object_id'));
    }
    return Object.freeze([...objectIds].sort());
  }
}

export const PAYLOAD_LIFECYCLE_EVENT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  project_id: { type: 'text' as const, nullable: false },
  object_id: { type: 'text' as const, nullable: false },
  sequence: { type: 'integer' as const, nullable: false },
  event_digest: { type: 'text' as const, nullable: false },
  event_json: { type: 'text' as const, nullable: false },
};

export function definePayloadLifecycleDatabaseModel(
  database: Readonly<{ define(name: string, definition: unknown): void }>,
): void {
  database.define('payload_lifecycle_events', PAYLOAD_LIFECYCLE_EVENT_MODEL);
}

function materialize(
  projectId: string,
  objectId: string,
  expectedSequence: number,
  drafts: readonly PayloadLifecycleEventDraft[],
): readonly PayloadLifecycleEvent[] {
  return deepFreeze(drafts.map((draft, offset) => {
    const body = deepFreeze({
      ...structuredClone(draft),
      version: 1 as const,
      projectId,
      objectId,
      sequence: expectedSequence + offset + 1,
    });
    return deepFreeze({ ...body, digest: digest(body) }) as PayloadLifecycleEvent;
  }));
}

function parseRows(
  projectId: string,
  objectId: string,
  rows: readonly Record<string, unknown>[],
): readonly PayloadLifecycleEvent[] {
  const sorted = [...rows].sort((left, right) =>
    sequence(left.sequence, 'row.sequence') - sequence(right.sequence, 'row.sequence'));
  const events = sorted.map((row, index) => {
    exactRow(row);
    if (row.project_id !== projectId || row.object_id !== objectId
      || sequence(row.sequence, 'row.sequence') !== index
      || row.id !== payloadLifecycleRowId(projectId, objectId, index)
      || typeof row.event_json !== 'string') {
      throw new Error('Payload Lifecycle database row scope/sequence drift');
    }
    const value = JSON.parse(row.event_json) as PayloadLifecycleEvent;
    const { digest: supplied, ...body } = value;
    if (value.version !== 1 || value.projectId !== projectId || value.objectId !== objectId
      || value.sequence !== index || row.event_digest !== supplied || supplied !== digest(body)
      || row.event_json !== canonicalWorkroomJson(value)) {
      throw new Error('Payload Lifecycle database event drift');
    }
    return deepFreeze(structuredClone(value));
  });
  replayPayloadLifecycle(projectId, objectId, events);
  return deepFreeze(events);
}

function toRow(event: PayloadLifecycleEvent): Record<string, unknown> {
  return {
    id: payloadLifecycleRowId(event.projectId, event.objectId, event.sequence),
    project_id: event.projectId,
    object_id: event.objectId,
    sequence: event.sequence,
    event_digest: event.digest,
    event_json: canonicalWorkroomJson(event),
  };
}

function payloadLifecycleRowId(projectId: string, objectId: string, sequence: number): string {
  return `${createHash('sha256').update(`${projectId}\0${objectId}`).digest('hex')}:${sequence}`;
}

function toDraft(event: PayloadLifecycleEvent): PayloadLifecycleEventDraft {
  const {
    version: _version,
    projectId: _projectId,
    objectId: _objectId,
    sequence: _sequence,
    digest: _digest,
    ...draft
  } = structuredClone(event);
  return deepFreeze(draft) as PayloadLifecycleEventDraft;
}

function exactReplay(
  events: readonly PayloadLifecycleEvent[],
  expectedSequence: number,
  drafts: readonly PayloadLifecycleEventDraft[],
): readonly PayloadLifecycleEvent[] | undefined {
  const first = expectedSequence + 1;
  if (events.length < first + drafts.length) return undefined;
  const candidate = events.slice(first, first + drafts.length);
  return canonicalWorkroomJson(candidate.map(toDraft)) === canonicalWorkroomJson(drafts)
    ? deepFreeze(candidate)
    : undefined;
}

function assertPrefix(
  projectId: string,
  objectId: string,
  source: readonly PayloadLifecycleEvent[],
  target: readonly PayloadLifecycleEvent[],
): void {
  replayPayloadLifecycle(projectId, objectId, source);
  replayPayloadLifecycle(projectId, objectId, target);
  const shared = Math.min(source.length, target.length);
  for (let index = 0; index < shared; index += 1) {
    if (canonicalWorkroomJson(source[index]) !== canonicalWorkroomJson(target[index])) {
      throw new Error('Payload Lifecycle File/Database handoff diverged');
    }
  }
}

function exactRow(row: Record<string, unknown>): void {
  const keys = ['id', 'project_id', 'object_id', 'sequence', 'event_digest', 'event_json'];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) {
    throw new Error('Payload Lifecycle database row exact schema drift');
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Payload Lifecycle ${label} is invalid`);
  }
  return value;
}

function sequence(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`Payload Lifecycle ${label} is invalid`);
  }
  return Number(value);
}

function isDatabaseCasLoser(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === '23505'
    || code === '40001'
    || code === 'SQLITE_CONSTRAINT'
    || code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    || code === 'SQLITE_BUSY_SNAPSHOT';
}
