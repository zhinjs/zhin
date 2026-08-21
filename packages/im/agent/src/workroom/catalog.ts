import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WorkroomDefinition } from './catalog-definition.js';
import { validateWorkroomDefinitions } from '../config/validate-ai-config.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
} from './canonical-value.js';

export interface WorkroomCatalogSnapshot {
  readonly definitions: Readonly<Record<string, WorkroomDefinition>>;
  readonly revision: string;
}

export interface WorkroomCatalog {
  read(): Promise<WorkroomCatalogSnapshot>;
  replace(
    definitions: Readonly<Record<string, WorkroomDefinition>>,
    expectedRevision: string,
  ): Promise<WorkroomCatalogSnapshot>;
}

export class WorkroomCatalogRevisionConflictError extends Error {
  constructor(readonly expectedRevision: string, readonly actualRevision: string) {
    super('Workroom Catalog 已被其他会话修改，请刷新后重试');
    this.name = 'WorkroomCatalogRevisionConflictError';
  }
}

export class ActivatableWorkroomCatalog implements WorkroomCatalog {
  #delegate: WorkroomCatalog | null = null;

  activate(delegate: WorkroomCatalog): void {
    if (this.#delegate) throw new Error('Workroom Catalog storage is already active');
    this.#delegate = delegate;
  }

  read(): Promise<WorkroomCatalogSnapshot> {
    return this.#require().read();
  }

  replace(
    definitions: Readonly<Record<string, WorkroomDefinition>>,
    expectedRevision: string,
  ): Promise<WorkroomCatalogSnapshot> {
    return this.#require().replace(definitions, expectedRevision);
  }

  #require(): WorkroomCatalog {
    if (!this.#delegate) throw new Error('Workroom Catalog storage is not active');
    return this.#delegate;
  }
}

/** Restart-durable fallback used when ai.sessions.useDatabase=false. */
export class FileWorkroomCatalog implements WorkroomCatalog {
  #tail: Promise<unknown> = Promise.resolve();

  constructor(readonly file: string) {}

  async read(): Promise<WorkroomCatalogSnapshot> {
    return parseCatalogFile(await readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    }));
  }

  replace(
    definitions: Readonly<Record<string, WorkroomDefinition>>,
    expectedRevision: string,
  ): Promise<WorkroomCatalogSnapshot> {
    const run = this.#tail.then(() => this.#replace(definitions, expectedRevision));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #replace(
    definitions: Readonly<Record<string, WorkroomDefinition>>,
    expectedRevision: string,
  ): Promise<WorkroomCatalogSnapshot> {
    revision(expectedRevision, 'expectedRevision');
    const candidate = catalogSnapshot(definitions);
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      if (current.revision === candidate.revision) {
        await syncDirectory(dirname(this.file));
        return current;
      }
      throw new WorkroomCatalogRevisionConflictError(expectedRevision, current.revision);
    }
    const directory = dirname(this.file);
    await ensureDurableDirectory(directory);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const lock = `${this.file}.cas-${expectedRevision}`;
    const encoded = JSON.stringify({
      version: 1,
      revision: candidate.revision,
      definitions: candidate.definitions,
    });
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(encoded, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    let ownsLock = false;
    try {
      try {
        await link(temporary, lock);
        ownsLock = true;
      } catch (error) {
        if (!isNodeError(error, 'EEXIST')) throw error;
        const recovered = await this.#publishPending(lock, expectedRevision, directory);
        if (recovered.revision === candidate.revision) return recovered;
        throw new WorkroomCatalogRevisionConflictError(expectedRevision, recovered.revision);
      }
      await unlink(temporary).catch(error => {
        if (!isNodeError(error, 'ENOENT')) throw error;
      });
      const latest = await this.read();
      if (latest.revision !== expectedRevision) {
        if (latest.revision === candidate.revision) {
          await syncDirectory(directory);
          return latest;
        }
        throw new WorkroomCatalogRevisionConflictError(expectedRevision, latest.revision);
      }
      try {
        await rename(lock, this.file);
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error;
        const recovered = await this.read();
        if (recovered.revision !== candidate.revision) {
          throw new WorkroomCatalogRevisionConflictError(expectedRevision, recovered.revision);
        }
      }
      ownsLock = false;
      await syncDirectory(directory);
      const stored = await this.read();
      if (stored.revision !== candidate.revision) {
        throw new Error('Workroom Catalog durable publish drift');
      }
      return stored;
    } finally {
      await unlink(temporary).catch(() => undefined);
      if (ownsLock) await unlink(lock).catch(() => undefined);
    }
  }

  async #publishPending(
    lock: string,
    expectedRevision: string,
    directory: string,
  ): Promise<WorkroomCatalogSnapshot> {
    const pending = await readFile(lock, 'utf8').then(parseCatalogFile).catch(async error => {
      if (!isNodeError(error, 'ENOENT')) throw error;
      return await this.read();
    });
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      await unlink(lock).catch(error => {
        if (!isNodeError(error, 'ENOENT')) throw error;
      });
      await syncDirectory(directory);
      return current;
    }
    try {
      await rename(lock, this.file);
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
    }
    await syncDirectory(directory);
    const published = await this.read();
    if (published.revision === expectedRevision && pending.revision !== expectedRevision) {
      throw new Error('Workroom Catalog pending publish disappeared before recovery');
    }
    return published;
  }
}

export interface WorkroomCatalogModel {
  select(...fields: string[]): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
}

interface WorkroomCatalogTransaction {
  select(table: string): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
  update(table: string, values: Record<string, unknown>): { where(query: Record<string, unknown>): Promise<unknown> };
}

interface WorkroomCatalogDatabase {
  transaction<T>(
    operation: (transaction: WorkroomCatalogTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

export class DatabaseWorkroomCatalog implements WorkroomCatalog {
  constructor(
    readonly database: WorkroomCatalogDatabase,
    readonly model: WorkroomCatalogModel,
  ) {}

  async read(): Promise<WorkroomCatalogSnapshot> {
    const rows = await this.model.select().where({ id: 'catalog' });
    if (rows.length > 1) throw new Error('Workroom Catalog database contains duplicate catalog rows');
    return parseCatalogRow(rows[0]);
  }

  async replace(
    definitions: Readonly<Record<string, WorkroomDefinition>>,
    expectedRevision: string,
  ): Promise<WorkroomCatalogSnapshot> {
    return this.database.transaction(async transaction => {
      const rows = await transaction.select('workroom_catalog').where({ id: 'catalog' });
      if (rows.length > 1) throw new Error('Workroom Catalog database contains duplicate catalog rows');
      const currentRow = rows[0];
      const current = parseCatalogRow(currentRow);
      const snapshot = catalogSnapshot(definitions);
      if (current.revision !== expectedRevision) {
        if (current.revision === snapshot.revision) return current;
        throw new WorkroomCatalogRevisionConflictError(expectedRevision, current.revision);
      }
      if (snapshot.revision === current.revision) return current;
      const values = {
        sequence: currentRow ? Number(currentRow.sequence) + 1 : 0,
        revision: snapshot.revision,
        definitions_json: JSON.stringify(snapshot.definitions),
        updated_at: Date.now(),
      };
      if (currentRow) {
        const affected = await transaction.update('workroom_catalog', values).where({ id: 'catalog' });
        if (typeof affected === 'number' && affected !== 1) {
          throw new Error('Workroom Catalog database update lost its catalog row');
        }
      } else {
        await transaction.insertMany('workroom_catalog', [{ id: 'catalog', ...values }]);
      }
      return snapshot;
    }, { isolationLevel: 'SERIALIZABLE' });
  }
}

export const WORKROOM_CATALOG_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  sequence: { type: 'integer' as const, nullable: false },
  revision: { type: 'text' as const, nullable: false },
  definitions_json: { type: 'text' as const, nullable: false },
  updated_at: { type: 'integer' as const, nullable: false },
};

export function emptyWorkroomCatalogRevision(): string {
  return revisionFor({});
}

function parseCatalogFile(raw: string): WorkroomCatalogSnapshot {
  if (!raw) return catalogSnapshot({});
  const value = JSON.parse(raw) as { version?: unknown; revision?: unknown; definitions?: unknown };
  if (value.version !== 1 || !isRecord(value.definitions)) throw new Error('Invalid Workroom Catalog file schema');
  revision(value.revision, 'persisted revision');
  const snapshot = catalogSnapshot(value.definitions as Record<string, WorkroomDefinition>);
  if (snapshot.revision !== value.revision) throw new Error('Workroom Catalog revision digest mismatch');
  return snapshot;
}

function parseCatalogRow(row: Record<string, unknown> | undefined): WorkroomCatalogSnapshot {
  if (!row) return catalogSnapshot({});
  if (!Number.isSafeInteger(Number(row.sequence)) || Number(row.sequence) < 0) {
    throw new Error('Invalid Workroom Catalog database sequence');
  }
  if (typeof row.definitions_json !== 'string') throw new Error('Invalid Workroom Catalog database row');
  const definitions = JSON.parse(row.definitions_json) as unknown;
  if (!isRecord(definitions)) throw new Error('Invalid Workroom Catalog database definitions');
  const snapshot = catalogSnapshot(definitions as Record<string, WorkroomDefinition>);
  if (row.revision !== snapshot.revision) throw new Error('Workroom Catalog revision digest mismatch');
  return snapshot;
}

function catalogSnapshot(
  definitions: Readonly<Record<string, WorkroomDefinition>>,
): WorkroomCatalogSnapshot {
  const normalized = normalizeDefinitions(definitions);
  return deepFreeze({ definitions: normalized, revision: revisionFor(normalized) });
}

function revisionFor(definitions: Readonly<Record<string, WorkroomDefinition>>): string {
  return createHash('sha256').update(canonicalWorkroomJson(definitions)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDefinitions(
  value: Readonly<Record<string, WorkroomDefinition>>,
): Readonly<Record<string, WorkroomDefinition>> {
  if (!isRecord(value)) throw new Error('Invalid Workroom Catalog definitions schema');
  const result: Record<string, WorkroomDefinition> = {};
  for (const projectId of Object.keys(value).sort()) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(projectId)) {
      throw new Error(`Invalid Workroom Catalog projectId: ${projectId}`);
    }
    const definition = value[projectId];
    if (!isRecord(definition)) throw new Error(`Invalid Workroom Catalog ${projectId} schema`);
    exactKeys(definition, ['name', 'description', 'enabled', 'members', 'conversation'], projectId);
    text(definition.name, `${projectId}.name`);
    if (definition.description !== undefined && typeof definition.description !== 'string') {
      throw new Error(`Invalid Workroom Catalog ${projectId}.description`);
    }
    if (definition.enabled !== undefined && typeof definition.enabled !== 'boolean') {
      throw new Error(`Invalid Workroom Catalog ${projectId}.enabled`);
    }
    if (!Array.isArray(definition.members)) throw new Error(`Invalid Workroom Catalog ${projectId}.members`);
    const members = definition.members.map((member, index) => {
      if (!isRecord(member)) throw new Error(`Invalid Workroom Catalog ${projectId}.members.${index}`);
      exactKeys(member, ['agent', 'role'], `${projectId}.members.${index}`);
      text(member.agent, `${projectId}.members.${index}.agent`);
      if (!['orchestrator', 'executor', 'reviewer', 'integration'].includes(String(member.role))) {
        throw new Error(`Invalid Workroom Catalog ${projectId}.members.${index}.role`);
      }
      return { agent: member.agent, role: member.role } as WorkroomDefinition['members'][number];
    });
    let conversation: WorkroomDefinition['conversation'];
    if (definition.conversation !== undefined) {
      const entry = definition.conversation;
      if (!isRecord(entry)) throw new Error(`Invalid Workroom Catalog ${projectId}.conversation`);
      exactKeys(entry, ['adapter', 'endpoint', 'kind', 'id', 'agent'], `${projectId}.conversation`);
      text(entry.adapter, `${projectId}.conversation.adapter`);
      text(entry.endpoint, `${projectId}.conversation.endpoint`);
      text(entry.id, `${projectId}.conversation.id`);
      text(entry.agent, `${projectId}.conversation.agent`);
      if (!['group', 'channel', 'repository'].includes(String(entry.kind))) {
        throw new Error(`Invalid Workroom Catalog ${projectId}.conversation.kind`);
      }
      conversation = {
        adapter: entry.adapter,
        endpoint: entry.endpoint,
        kind: entry.kind,
        id: entry.id,
        agent: entry.agent,
      } as WorkroomDefinition['conversation'];
    }
    result[projectId] = {
      name: definition.name,
      ...(definition.description?.trim() ? { description: definition.description } : {}),
      ...(definition.enabled === undefined ? {} : { enabled: definition.enabled }),
      members,
      ...(conversation === undefined ? {} : { conversation }),
    };
  }
  const intrinsicErrors = validateWorkroomDefinitions(
    result,
    [...new Set(Object.values(result).flatMap(definition =>
      definition.members.map(member => member.agent)))],
  );
  if (intrinsicErrors.length > 0) {
    throw new Error(`Invalid Workroom Catalog: ${intrinsicErrors.join('; ')}`);
  }
  return deepFreeze(result);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allow = new Set(allowed);
  const unexpected = Object.keys(value).find(key => !allow.has(key));
  if (unexpected) throw new Error(`Invalid Workroom Catalog ${field} field: ${unexpected}`);
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Invalid Workroom Catalog ${field}`);
  }
}

function revision(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Invalid Workroom Catalog ${field}`);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureDurableDirectory(directory: string): Promise<void> {
  await mkdir(directory).catch(error => {
    if (!isNodeError(error, 'EEXIST')) throw error;
  });
  await syncDirectory(dirname(directory));
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
