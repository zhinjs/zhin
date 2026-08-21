import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  WorkroomAssignmentAuthorityGrant,
  WorkroomAssignmentAuthorityGrantPort,
  WorkroomAssignmentAuthorityGrantRequest,
} from '../plugin-runtime/workroom-assignment-authority-provider.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import { DurableFileStore } from './durable-file-store.js';
import type { AssignmentExecutionFactAnchor } from './assignment-executor.js';

export type AssignmentAuthorityGrantBlockerKind = 'capability' | 'disclosure';

export interface AssignmentAuthorityGrantBlocker {
  readonly kind: AssignmentAuthorityGrantBlockerKind;
  readonly owner: string;
  readonly reason: string;
  readonly deadline: number;
}

export interface AssignmentAuthorityGrantRecordInput {
  readonly assignmentKey: string;
  readonly revision: number;
  readonly previousDigest?: string;
  readonly generation: number;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly operationId: string;
  readonly agentDefinitionId: string;
  readonly endpointId: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly factAnchor: AssignmentExecutionFactAnchor;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: 'blocked' | 'ready';
  readonly blocker?: AssignmentAuthorityGrantBlocker;
  readonly grant?: WorkroomAssignmentAuthorityGrant;
}

export interface AssignmentAuthorityGrantRecord extends AssignmentAuthorityGrantRecordInput {
  readonly version: 1;
  readonly digest: string;
}

export interface AssignmentAuthorityGrantRepository {
  read(assignmentKey: string): Promise<AssignmentAuthorityGrantRecord | undefined>;
  append(
    record: AssignmentAuthorityGrantRecord,
    expectedDigest: string | undefined,
  ): Promise<Readonly<{ status: 'created' | 'replayed'; record: AssignmentAuthorityGrantRecord }>>;
}

export class ActivatableAssignmentAuthorityGrantRepository
implements AssignmentAuthorityGrantRepository {
  #delegate?: AssignmentAuthorityGrantRepository;

  activate(delegate: AssignmentAuthorityGrantRepository): void {
    if (this.#delegate) throw new Error('Assignment Authority Grant storage is already active');
    this.#delegate = delegate;
  }

  read(assignmentKey: string): Promise<AssignmentAuthorityGrantRecord | undefined> {
    return this.#require().read(assignmentKey);
  }

  append(record: AssignmentAuthorityGrantRecord, expectedDigest: string | undefined) {
    return this.#require().append(record, expectedDigest);
  }

  #require(): AssignmentAuthorityGrantRepository {
    if (!this.#delegate) throw new Error('Assignment Authority Grant storage is not active');
    return this.#delegate;
  }
}

export class AssignmentAuthorityGrantSequenceConflictError extends Error {
  constructor(
    readonly assignmentKey: string,
    readonly expectedDigest: string | undefined,
    readonly actualDigest: string | undefined,
  ) {
    super(`Assignment Authority Grant CAS conflict for ${assignmentKey}`);
    this.name = 'AssignmentAuthorityGrantSequenceConflictError';
  }
}

export function assignmentAuthorityGrantKey(
  input: Pick<WorkroomAssignmentAuthorityGrantRequest,
  'projectId' | 'runId' | 'taskKey' | 'taskRevision' | 'assignmentId'
  | 'assignmentRevision' | 'attempt' | 'fence' | 'requestedAgentDefinitionId'
  | 'requestedEndpointId'> & Readonly<{ generation: number }>,
): string {
  return `assignment-grant:v1:${digest({
    version: 1,
    generation: positive(input.generation, 'generation'),
    projectId: input.projectId,
    runId: input.runId,
    taskKey: input.taskKey,
    taskRevision: input.taskRevision,
    assignmentId: input.assignmentId,
    assignmentRevision: input.assignmentRevision,
    attempt: input.attempt,
    fence: input.fence,
    agentDefinitionId: input.requestedAgentDefinitionId,
    ...(input.requestedEndpointId === undefined ? {} : { endpointId: input.requestedEndpointId }),
  }).slice('sha256:'.length)}`;
}

export function createAssignmentAuthorityGrantRecord(
  input: AssignmentAuthorityGrantRecordInput,
): AssignmentAuthorityGrantRecord {
  validateRecordInput(input);
  const projection = deepFreeze({ version: 1 as const, ...structuredClone(input) });
  return deepFreeze({ ...projection, digest: digest(projection) });
}

/** Contract fixture. Production composition uses File or Database storage. */
export class MemoryAssignmentAuthorityGrantRepository implements AssignmentAuthorityGrantRepository {
  readonly #records = new Map<string, AssignmentAuthorityGrantRecord>();

  async read(assignmentKey: string): Promise<AssignmentAuthorityGrantRecord | undefined> {
    return this.#records.get(requiredText(assignmentKey, 'assignmentKey'));
  }

  async append(record: AssignmentAuthorityGrantRecord, expectedDigest: string | undefined) {
    const canonical = parseAssignmentAuthorityGrantRecord(record);
    const current = this.#records.get(canonical.assignmentKey);
    if (current?.digest === canonical.digest) {
      return Object.freeze({ status: 'replayed' as const, record: current });
    }
    assertAppend(current, canonical, expectedDigest);
    this.#records.set(canonical.assignmentKey, canonical);
    return Object.freeze({ status: 'created' as const, record: canonical });
  }
}

/** Immutable revision files: the revision pathname is the create-only CAS slot. */
export class FileAssignmentAuthorityGrantRepository implements AssignmentAuthorityGrantRepository {
  #tail: Promise<unknown> = Promise.resolve();
  readonly #store: DurableFileStore;

  constructor(readonly directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async read(assignmentKey: string): Promise<AssignmentAuthorityGrantRecord | undefined> {
    const key = keyDigest(requiredText(assignmentKey, 'assignmentKey'));
    const names = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const prefix = `${key}.`;
    const revisions = names.flatMap(name => {
      if (!name.startsWith(prefix) || name.endsWith('.tmp')) return [];
      const match = new RegExp(`^${key}\\.([1-9][0-9]*)\\.json$`, 'u').exec(name);
      if (!match) throw new Error('Assignment Authority Grant durable revision filename is invalid');
      const revision = Number(match[1]);
      if (!Number.isSafeInteger(revision)) {
        throw new Error('Assignment Authority Grant durable revision filename overflows');
      }
      return [revision];
    }).sort((left, right) => left - right);
    if (new Set(revisions).size !== revisions.length) {
      throw new Error('Assignment Authority Grant durable revision is duplicated');
    }
    let latest: AssignmentAuthorityGrantRecord | undefined;
    for (const [index, revision] of revisions.entries()) {
      if (revision !== index + 1) {
        throw new Error('Assignment Authority Grant durable revision chain has a gap');
      }
      const raw = await readFile(join(this.directory, `${key}.${revision}.json`), 'utf8');
      const current = parseAssignmentAuthorityGrantRecord(JSON.parse(raw));
      if (current.assignmentKey !== assignmentKey || current.revision !== revision) {
        throw new Error('Assignment Authority Grant durable revision scope drift');
      }
      if ((revision === 1 && current.previousDigest !== undefined)
        || (revision > 1 && current.previousDigest !== latest?.digest)) {
        throw new Error('Assignment Authority Grant durable chain drift');
      }
      latest = current;
    }
    if (latest) await this.#store.syncLeaf();
    return latest;
  }

  append(record: AssignmentAuthorityGrantRecord, expectedDigest: string | undefined) {
    const run = this.#tail.then(() => this.#append(record, expectedDigest));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #append(record: AssignmentAuthorityGrantRecord, expectedDigest: string | undefined) {
    const canonical = parseAssignmentAuthorityGrantRecord(record);
    await this.#store.ensureDurableLeaf('Assignment Authority Grant repository');
    const current = await this.read(canonical.assignmentKey);
    if (current?.digest === canonical.digest) {
      await this.#store.syncLeaf();
      return Object.freeze({ status: 'replayed' as const, record: current });
    }
    assertAppend(current, canonical, expectedDigest);
    const target = join(
      this.directory,
      `${keyDigest(canonical.assignmentKey)}.${canonical.revision}.json`,
    );
    const published = await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(canonical),
      createdValue: canonical,
      onConflict: async () => {
        const winner = parseAssignmentAuthorityGrantRecord(
          JSON.parse(await readFile(target, 'utf8')),
        );
        if (winner.digest !== canonical.digest) {
          throw new AssignmentAuthorityGrantSequenceConflictError(
            canonical.assignmentKey,
            expectedDigest,
            winner.digest,
          );
        }
        return winner;
      },
    });
    return Object.freeze({ status: published.status, record: published.value });
  }
}

export interface AssignmentAuthorityGrantDatabaseModel {
  select(...fields: string[]): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
}

interface AssignmentAuthorityGrantTransaction {
  select(table: string): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
}

interface AssignmentAuthorityGrantDatabase {
  transaction<T>(
    operation: (transaction: AssignmentAuthorityGrantTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

export class DatabaseAssignmentAuthorityGrantRepository
implements AssignmentAuthorityGrantRepository {
  constructor(
    readonly database: AssignmentAuthorityGrantDatabase,
    readonly model: AssignmentAuthorityGrantDatabaseModel,
  ) {}

  async read(assignmentKey: string): Promise<AssignmentAuthorityGrantRecord | undefined> {
    return latestDatabaseRecord(await this.model.select().where({
      assignment_key: requiredText(assignmentKey, 'assignmentKey'),
    }));
  }

  async append(record: AssignmentAuthorityGrantRecord, expectedDigest: string | undefined) {
    const canonical = parseAssignmentAuthorityGrantRecord(record);
    try {
      return await this.database.transaction(async transaction => {
        const rows = await transaction.select('workroom_assignment_authority_grants')
          .where({ assignment_key: canonical.assignmentKey });
        const current = latestDatabaseRecord(rows);
        if (current?.digest === canonical.digest) {
          return Object.freeze({ status: 'replayed' as const, record: current });
        }
        assertAppend(current, canonical, expectedDigest);
        await transaction.insertMany('workroom_assignment_authority_grants', [{
          id: `${keyDigest(canonical.assignmentKey)}:${canonical.revision}`,
          assignment_key: canonical.assignmentKey,
          revision: canonical.revision,
          digest: canonical.digest,
          record_json: canonicalWorkroomJson(canonical),
          created_at: canonical.createdAt,
        }]);
        return Object.freeze({ status: 'created' as const, record: canonical });
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (!isDatabaseCasLoser(error)) throw error;
      const winner = await this.read(canonical.assignmentKey);
      if (winner?.digest === canonical.digest) {
        return Object.freeze({ status: 'replayed' as const, record: winner });
      }
      throw new AssignmentAuthorityGrantSequenceConflictError(
        canonical.assignmentKey,
        expectedDigest,
        winner?.digest,
      );
    }
  }
}

export const WORKROOM_ASSIGNMENT_AUTHORITY_GRANT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  assignment_key: { type: 'text' as const, nullable: false },
  revision: { type: 'integer' as const, nullable: false },
  digest: { type: 'text' as const, nullable: false },
  record_json: { type: 'text' as const, nullable: false },
  created_at: { type: 'integer' as const, nullable: false },
};

export function createDurableWorkroomAssignmentAuthorityGrantProvider(options: Readonly<{
  repository: Pick<AssignmentAuthorityGrantRepository, 'read'>;
  generation: number;
  now?: () => number;
}>): WorkroomAssignmentAuthorityGrantPort {
  positive(options.generation, 'generation');
  const now = options.now ?? Date.now;
  return Object.freeze({
    resolve: async (request: WorkroomAssignmentAuthorityGrantRequest) => {
      const record = await options.repository.read(assignmentAuthorityGrantKey({
        ...request,
        generation: options.generation,
      }));
      if (!record || record.status !== 'ready' || !record.grant) return undefined;
      if (record.generation !== options.generation || record.expiresAt <= now()) return undefined;
      if (!recordMatchesRequest(record, request)) return undefined;
      if (!grantMatchesRecord(record.grant, record)) return undefined;
      return record.grant;
    },
  });
}

export function parseAssignmentAuthorityGrantRecord(value: unknown): AssignmentAuthorityGrantRecord {
  if (!isRecord(value)) throw new Error('Assignment Authority Grant record must be an object');
  const { digest: actualDigest, version, ...input } = value;
  if (version !== 1 || typeof actualDigest !== 'string') {
    throw new Error('Assignment Authority Grant record version or digest is invalid');
  }
  const canonical = createAssignmentAuthorityGrantRecord(input as unknown as AssignmentAuthorityGrantRecordInput);
  if (canonical.digest !== actualDigest) throw new Error('Assignment Authority Grant record digest drift');
  return canonical;
}

function assertAppend(
  current: AssignmentAuthorityGrantRecord | undefined,
  candidate: AssignmentAuthorityGrantRecord,
  expectedDigest: string | undefined,
): void {
  if (current?.digest !== expectedDigest
    || candidate.revision !== (current?.revision ?? 0) + 1
    || candidate.previousDigest !== expectedDigest) {
    throw new AssignmentAuthorityGrantSequenceConflictError(
      candidate.assignmentKey,
      expectedDigest,
      current?.digest,
    );
  }
  for (const field of [
    'assignmentKey', 'generation', 'projectId', 'runId', 'taskKey', 'taskRevision',
    'assignmentId', 'assignmentRevision', 'attempt', 'fence', 'operationId',
    'agentDefinitionId', 'endpointId', 'profileRevisionId', 'profileDigest',
  ] as const) {
    if (current && current[field] !== candidate[field]) {
      throw new Error(`Assignment Authority Grant immutable ${field} drift`);
    }
  }
}

function validateRecordInput(input: AssignmentAuthorityGrantRecordInput): void {
  const expected = [
    'assignmentKey', 'revision', 'previousDigest', 'generation', 'projectId', 'runId',
    'taskKey', 'taskRevision', 'assignmentId', 'assignmentRevision', 'attempt', 'fence',
    'operationId', 'agentDefinitionId', 'endpointId', 'profileRevisionId', 'profileDigest',
    'factAnchor', 'createdAt', 'expiresAt', 'status', 'blocker', 'grant',
  ];
  const unexpected = Object.keys(input).find(key => !expected.includes(key));
  if (unexpected) throw new Error(`Assignment Authority Grant record has unexpected ${unexpected}`);
  for (const field of [
    'assignmentKey', 'projectId', 'runId', 'taskKey', 'assignmentId', 'operationId',
    'agentDefinitionId', 'endpointId', 'profileRevisionId', 'profileDigest',
  ] as const) requiredText(input[field], field);
  for (const field of [
    'revision', 'generation', 'taskRevision', 'assignmentRevision', 'attempt', 'fence',
  ] as const) positive(input[field], field);
  nonNegative(input.createdAt, 'createdAt');
  nonNegative(input.expiresAt, 'expiresAt');
  if (input.expiresAt <= input.createdAt) throw new Error('Assignment Authority Grant must expire after creation');
  if ((input.revision === 1) !== (input.previousDigest === undefined)) {
    throw new Error('Assignment Authority Grant previous digest/revision mismatch');
  }
  if (input.status === 'ready') {
    if (!input.grant || input.blocker) throw new Error('Ready Assignment Authority Grant record is invalid');
  } else if (input.status === 'blocked') {
    if (!input.blocker || input.grant) throw new Error('Blocked Assignment Authority Grant record is invalid');
    if (input.blocker.kind !== 'capability' && input.blocker.kind !== 'disclosure') {
      throw new Error('Assignment Authority Grant blocker kind is invalid');
    }
    requiredText(input.blocker.owner, 'blocker.owner');
    requiredText(input.blocker.reason, 'blocker.reason');
    nonNegative(input.blocker.deadline, 'blocker.deadline');
  } else {
    throw new Error('Assignment Authority Grant status is invalid');
  }
  requiredText(input.factAnchor.ref, 'factAnchor.ref');
  nonNegative(input.factAnchor.sequence, 'factAnchor.sequence');
  requiredText(input.factAnchor.digest, 'factAnchor.digest');
}

function recordMatchesRequest(
  record: AssignmentAuthorityGrantRecord,
  request: WorkroomAssignmentAuthorityGrantRequest,
): boolean {
  return record.projectId === request.projectId
    && record.runId === request.runId
    && record.taskKey === request.taskKey
    && record.taskRevision === request.taskRevision
    && record.assignmentId === request.assignmentId
    && record.assignmentRevision === request.assignmentRevision
    && record.attempt === request.attempt
    && record.fence === request.fence
    && record.agentDefinitionId === request.requestedAgentDefinitionId
    && record.endpointId === request.requestedEndpointId;
}

function grantMatchesRecord(
  grant: WorkroomAssignmentAuthorityGrant,
  record: AssignmentAuthorityGrantRecord,
): boolean {
  return grant.generation === record.generation
    && grant.projectId === record.projectId
    && grant.runId === record.runId
    && grant.taskKey === record.taskKey
    && grant.taskRevision === record.taskRevision
    && grant.assignmentId === record.assignmentId
    && grant.assignmentRevision === record.assignmentRevision
    && grant.attempt === record.attempt
    && grant.fence === record.fence
    && grant.agentDefinitionId === record.agentDefinitionId
    && grant.endpointId === record.endpointId
    && grant.profileRevisionId === record.profileRevisionId
    && grant.profileDigest === record.profileDigest;
}

function latestDatabaseRecord(rows: readonly Record<string, unknown>[]): AssignmentAuthorityGrantRecord | undefined {
  const parsed = rows.map(row => {
    if (typeof row.record_json !== 'string') throw new Error('Assignment Authority Grant database row is invalid');
    const record = parseAssignmentAuthorityGrantRecord(JSON.parse(row.record_json));
    if (row.assignment_key !== record.assignmentKey
      || Number(row.revision) !== record.revision
      || row.digest !== record.digest) {
      throw new Error('Assignment Authority Grant database row scope drift');
    }
    return record;
  }).sort((left, right) => left.revision - right.revision);
  for (let index = 0; index < parsed.length; index += 1) {
    const current = parsed[index]!;
    const previous = parsed[index - 1];
    if (current.revision !== index + 1 || current.previousDigest !== previous?.digest) {
      throw new Error('Assignment Authority Grant database chain drift');
    }
  }
  return parsed.at(-1);
}

function keyDigest(value: string): string {
  return digest({ assignmentKey: value }).slice('sha256:'.length);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Assignment Authority Grant ${field} is required`);
  }
  return value;
}

function positive(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Assignment Authority Grant ${field} must be a positive integer`);
  }
  return Number(value);
}

function nonNegative(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Assignment Authority Grant ${field} must be a non-negative integer`);
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
