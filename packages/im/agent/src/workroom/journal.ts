import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkroomEvent, WorkroomEventDraft } from './kernel-contracts.js';

export class WorkroomSequenceConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(`Workroom ${runId} sequence conflict: expected ${expectedSequence}, actual ${actualSequence}`);
    this.name = 'WorkroomSequenceConflictError';
  }
}

export interface WorkroomJournal {
  listRunIds(): Promise<readonly string[]>;
  read(runId: string): Promise<readonly WorkroomEvent[]>;
  append(
    runId: string,
    expectedSequence: number,
    events: readonly WorkroomEventDraft[],
  ): Promise<readonly WorkroomEvent[]>;
}

export class MemoryWorkroomJournal implements WorkroomJournal {
  readonly #runs = new Map<string, readonly WorkroomEvent[]>();

  async listRunIds(): Promise<readonly string[]> {
    return Object.freeze([...this.#runs.keys()].sort());
  }

  async read(runId: string): Promise<readonly WorkroomEvent[]> {
    return this.#runs.get(runId) ?? [];
  }

  async append(
    runId: string,
    expectedSequence: number,
    drafts: readonly WorkroomEventDraft[],
  ): Promise<readonly WorkroomEvent[]> {
    const current = this.#runs.get(runId) ?? [];
    const actualSequence = current.at(-1)?.sequence ?? -1;
    if (actualSequence !== expectedSequence) {
      throw new WorkroomSequenceConflictError(runId, expectedSequence, actualSequence);
    }
    if (drafts.length === 0) return [];
    const appended = materializeEvents(runId, expectedSequence, drafts);
    this.#runs.set(runId, Object.freeze([...current, ...appended]));
    return appended;
  }
}

/**
 * Durable append-only journal. Every committed batch is an immutable segment;
 * publishing its first sequence with an exclusive hard-link is the filesystem
 * CAS. Separate generation instances and separate processes therefore cannot
 * overwrite one another after reading the same expectedSequence.
 */
export class FileWorkroomJournal implements WorkroomJournal {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  async listRunIds(): Promise<readonly string[]> {
    await mkdir(this.#directory, { recursive: true });
    const names = await readdir(this.#directory);
    const ids = new Set<string>();
    for (const name of names) {
      if (!isSegmentName(name)) continue;
      const events = await this.#readFile(join(this.#directory, name));
      const runId = events[0]?.runId;
      if (runId) ids.add(runId);
    }
    return Object.freeze([...ids].sort());
  }

  async read(runId: string): Promise<readonly WorkroomEvent[]> {
    const digest = this.#digest(runId);
    let names: string[];
    try {
      names = (await readdir(this.#directory))
        .filter(name => name.startsWith(`${digest}.`) && isSegmentName(name))
        .sort();
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const segments = await Promise.all(names.map(name => this.#readFile(join(this.#directory, name))));
    const events = segments.flat();
    if (events.some(event => event.runId !== runId)) {
      throw new Error('Workroom journal digest collision');
    }
    return Object.freeze(events.sort((left, right) => left.sequence - right.sequence));
  }

  async append(
    runId: string,
    expectedSequence: number,
    drafts: readonly WorkroomEventDraft[],
  ): Promise<readonly WorkroomEvent[]> {
    const current = await this.read(runId);
    const actualSequence = current.at(-1)?.sequence ?? -1;
    if (actualSequence !== expectedSequence) {
      throw new WorkroomSequenceConflictError(runId, expectedSequence, actualSequence);
    }
    if (drafts.length === 0) return [];
    const result = materializeEvents(runId, expectedSequence, drafts);
    await mkdir(this.#directory, { recursive: true });
    const segment = this.#segmentPath(runId, expectedSequence + 1);
    const temporary = `${segment}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(result), { encoding: 'utf8', flag: 'wx' });
      await link(temporary, segment);
    } catch (error) {
      if (isAlreadyExists(error)) {
        const winner = await this.read(runId);
        throw new WorkroomSequenceConflictError(
          runId,
          expectedSequence,
          winner.at(-1)?.sequence ?? -1,
        );
      }
      throw error;
    } finally {
      await unlink(temporary).catch(error => {
        if (!isMissingFile(error)) throw error;
      });
    }
    return result;
  }

  async #readFile(path: string): Promise<readonly WorkroomEvent[]> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Workroom journal file must contain an event array');
      return parseEvents(parsed);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  #digest(runId: string): string {
    return createHash('sha256').update(runId).digest('hex');
  }

  #segmentPath(runId: string, firstSequence: number): string {
    return join(this.#directory, `${this.#digest(runId)}.${String(firstSequence).padStart(16, '0')}.json`);
  }
}

/** Candidate-owned latch: no caller can observe a placeholder journal. */
export class ActivatableWorkroomJournal implements WorkroomJournal {
  #delegate: WorkroomJournal | null = null;

  get active(): boolean {
    return this.#delegate !== null;
  }

  activate(delegate: WorkroomJournal): void {
    if (this.#delegate) throw new Error('Workroom journal is already active');
    this.#delegate = delegate;
  }

  listRunIds(): Promise<readonly string[]> {
    return this.#require().listRunIds();
  }

  read(runId: string): Promise<readonly WorkroomEvent[]> {
    return this.#require().read(runId);
  }

  append(runId: string, expectedSequence: number, events: readonly WorkroomEventDraft[]): Promise<readonly WorkroomEvent[]> {
    return this.#require().append(runId, expectedSequence, events);
  }

  #require(): WorkroomJournal {
    if (!this.#delegate) throw new Error('Workroom journal is not active');
    return this.#delegate;
  }
}

interface WorkroomEventModel {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
}

interface WorkroomTransaction {
  select(table: string): {
    where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
}

interface WorkroomDatabase {
  transaction<T>(
    operation: (transaction: WorkroomTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

export class DatabaseWorkroomJournal implements WorkroomJournal {
  readonly #database: WorkroomDatabase;
  readonly #eventModel: WorkroomEventModel;

  constructor(
    database: WorkroomDatabase,
    eventModel: WorkroomEventModel,
  ) {
    this.#database = database;
    this.#eventModel = eventModel;
  }

  async listRunIds(): Promise<readonly string[]> {
    const rows = await this.#eventModel.select('run_id').where({});
    return Object.freeze([...new Set(rows.map(row => String(row.run_id)))].sort());
  }

  async read(runId: string): Promise<readonly WorkroomEvent[]> {
    const rows = await this.#eventModel.select().where({ run_id: runId });
    return parseRows(runId, rows);
  }

  async append(
    runId: string,
    expectedSequence: number,
    drafts: readonly WorkroomEventDraft[],
  ): Promise<readonly WorkroomEvent[]> {
    try {
      return await this.#database.transaction(async transaction => {
        const rows = await transaction.select('workroom_events').where({ run_id: runId });
        const current = parseRows(runId, rows);
        const actualSequence = current.at(-1)?.sequence ?? -1;
        if (actualSequence !== expectedSequence) {
          throw new WorkroomSequenceConflictError(runId, expectedSequence, actualSequence);
        }
        if (drafts.length === 0) return [];
        const appended = materializeEvents(runId, expectedSequence, drafts);
        await transaction.insertMany('workroom_events', appended.map(toRow));
        return appended;
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (error instanceof WorkroomSequenceConflictError) throw error;
      // A serializable/unique-key loser is dialect-specific. Re-read the
      // authoritative sequence and normalize only a proven concurrent winner;
      // unrelated database failures retain their original error.
      const actualSequence = (await this.read(runId)).at(-1)?.sequence ?? -1;
      if (actualSequence !== expectedSequence) {
        throw new WorkroomSequenceConflictError(runId, expectedSequence, actualSequence);
      }
      throw error;
    }
  }
}

function materializeEvents(
  runId: string,
  expectedSequence: number,
  drafts: readonly WorkroomEventDraft[],
): readonly WorkroomEvent[] {
  if (!isNonEmptyString(runId) || !Number.isSafeInteger(expectedSequence) || expectedSequence < -1) {
    throw new Error('Invalid Workroom append position');
  }
  return Object.freeze(drafts.map<WorkroomEvent>((draft, index) => {
    if (!isNonEmptyString(draft.eventId) || !isFiniteNumber(draft.occurredAt)
      || !isWorkroomEventType(draft.type) || !isRecord(draft.payload)) {
      throw new Error('Invalid Workroom event draft');
    }
    validatePayload(draft.type, draft.payload);
    return Object.freeze({
      ...draft,
      version: 1,
      runId,
      sequence: expectedSequence + index + 1,
      payload: Object.freeze({ ...draft.payload }),
    });
  }));
}

function parseEvents(values: readonly unknown[]): readonly WorkroomEvent[] {
  const events = values.map((value): WorkroomEvent => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid Workroom journal event');
    }
    const event = value as Partial<WorkroomEvent>;
    if (event.version !== 1 || !isNonEmptyString(event.eventId) || !isNonEmptyString(event.runId)
      || !isSequence(event.sequence) || !isFiniteNumber(event.occurredAt)
      || !isWorkroomEventType(event.type) || !isRecord(event.payload)) {
      throw new Error('Invalid Workroom journal event');
    }
    validatePayload(event.type, event.payload);
    const sequence = Number(event.sequence);
    return Object.freeze({
      ...event,
      version: 1,
      eventId: event.eventId,
      runId: event.runId,
      sequence,
      occurredAt: event.occurredAt,
      type: event.type,
      payload: Object.freeze({ ...event.payload }),
    });
  });
  return Object.freeze(events.sort((left, right) => left.sequence - right.sequence));
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST';
}

function isSegmentName(name: string): boolean {
  return /^[a-f0-9]{64}\.[0-9]{16}\.json$/u.test(name);
}

function toRow(event: WorkroomEvent): Record<string, unknown> {
  return {
    id: `${event.runId}:${event.sequence}`,
    run_id: event.runId,
    sequence: event.sequence,
    version: event.version,
    type: event.type,
    payload_json: JSON.stringify({ eventId: event.eventId, payload: event.payload }),
    occurred_at: event.occurredAt,
  };
}

function parseRows(runId: string, rows: readonly Record<string, unknown>[]): readonly WorkroomEvent[] {
  const events = rows.map(row => {
    if (row.version !== 1) throw new Error(`Unsupported Workroom event version: ${String(row.version)}`);
    const envelope = JSON.parse(String(row.payload_json)) as {
      eventId?: unknown;
      payload?: unknown;
    };
    if (!envelope || !isNonEmptyString(envelope.eventId) || !isRecord(envelope.payload)
      || !isSequence(row.sequence) || !isFiniteNumber(row.occurred_at)
      || !isWorkroomEventType(row.type)) {
      throw new Error('Invalid Workroom event payload envelope');
    }
    validatePayload(row.type, envelope.payload);
    return Object.freeze<WorkroomEvent>({
      version: 1 as const,
      eventId: envelope.eventId,
      runId,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      type: row.type,
      payload: Object.freeze({ ...envelope.payload }),
    });
  }).sort((left, right) => left.sequence - right.sequence);
  return Object.freeze(events);
}

const WORKROOM_EVENT_TYPES = new Set<WorkroomEvent['type']>([
  'run.created', 'run.cancel_requested', 'run.cancelled',
  'task.planned', 'task.blocked', 'task.blocker_resolved',
  'task.cancel_requested', 'task.cancelled', 'task.failed',
  'task.accepted', 'task.rework_requested', 'task.revised',
  'assignment.claimed', 'assignment.started', 'assignment.heartbeat',
  'assignment.execution_completed', 'assignment.cancel_requested',
  'assignment.cancelled', 'assignment.lease_expired', 'clock.advanced',
]);

function isWorkroomEventType(value: unknown): value is WorkroomEvent['type'] {
  return typeof value === 'string' && WORKROOM_EVENT_TYPES.has(value as WorkroomEvent['type']);
}

function validatePayload(type: WorkroomEvent['type'], payload: Readonly<Record<string, unknown>>): void {
  switch (type) {
    case 'run.created':
      requirePayloadString(payload, 'projectId'); requirePayloadString(payload, 'title'); return;
    case 'run.cancel_requested':
    case 'run.cancelled':
      requirePayloadString(payload, 'reason'); return;
    case 'task.planned':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'title');
      requirePayloadBoolean(payload, 'required'); requirePayloadPositiveInteger(payload, 'maxAttempts'); return;
    case 'task.blocked':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'blockerId');
      requirePayloadEnum(payload, 'kind', ['dependency', 'approval', 'capability', 'external', 'human_input']);
      requirePayloadString(payload, 'owner'); requirePayloadString(payload, 'reason');
      requirePayloadNumber(payload, 'deadline'); return;
    case 'task.blocker_resolved':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'blockerId'); return;
    case 'task.cancel_requested':
    case 'task.cancelled':
    case 'task.failed':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason'); return;
    case 'task.accepted':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reportRef'); return;
    case 'task.rework_requested':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'reason'); return;
    case 'task.revised':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'title');
      requirePayloadString(payload, 'reason'); requirePayloadPositiveInteger(payload, 'maxAttempts'); return;
    case 'assignment.claimed':
      requirePayloadString(payload, 'taskKey'); requirePayloadString(payload, 'assignmentId');
      requirePayloadString(payload, 'owner'); requirePayloadEnum(payload, 'role', ['executor', 'reviewer', 'integration']);
      requirePayloadPositiveInteger(payload, 'taskRevision'); requirePayloadPositiveInteger(payload, 'attempt');
      requirePayloadNumber(payload, 'leaseExpiresAt'); return;
    case 'assignment.started':
    case 'assignment.lease_expired':
      requirePayloadString(payload, 'assignmentId'); return;
    case 'assignment.heartbeat':
      requirePayloadString(payload, 'assignmentId'); requirePayloadNumber(payload, 'leaseExpiresAt'); return;
    case 'assignment.execution_completed':
      requirePayloadString(payload, 'assignmentId'); requirePayloadString(payload, 'reportRef'); return;
    case 'assignment.cancel_requested':
      requirePayloadString(payload, 'assignmentId'); requirePayloadNumber(payload, 'controlDeadline'); return;
    case 'assignment.cancelled':
      requirePayloadString(payload, 'assignmentId');
      requirePayloadEnum(payload, 'outcome', ['interrupted', 'committed', 'outcome_unknown']); return;
    case 'clock.advanced':
      requirePayloadNumber(payload, 'now'); return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requirePayloadString(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (!isNonEmptyString(payload[key])) throw new Error(`Invalid Workroom event payload: ${key}`);
}

function requirePayloadNumber(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (!isFiniteNumber(payload[key])) throw new Error(`Invalid Workroom event payload: ${key}`);
}

function requirePayloadPositiveInteger(payload: Readonly<Record<string, unknown>>, key: string): void {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Invalid Workroom event payload: ${key}`);
  }
}

function requirePayloadBoolean(payload: Readonly<Record<string, unknown>>, key: string): void {
  if (typeof payload[key] !== 'boolean') throw new Error(`Invalid Workroom event payload: ${key}`);
}

function requirePayloadEnum(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  values: readonly string[],
): void {
  if (typeof payload[key] !== 'string' || !values.includes(payload[key])) {
    throw new Error(`Invalid Workroom event payload: ${key}`);
  }
}
