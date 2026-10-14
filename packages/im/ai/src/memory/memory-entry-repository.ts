/**
 * MemoryEntryRepository — CRUD + text search for semantic memory (L4).
 */
import { randomUUID } from 'node:crypto';
import { rankMemoryEntries } from './memory-bm25.js';
import {
  appendMemoryHistory,
  MEMORY_ENTRY_ADDED_COLUMNS,
  normalizeMemoryKind,
  normalizeMemoryTrustLevel,
  serializeMemoryTags,
  type MemoryEntryRecord,
  type MemoryEntryScope,
  type MemoryEntrySearchInput,
  type MemoryEntryUpsertInput,
} from './memory-entry-models.js';

type DbModel = {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
  update(data: Record<string, unknown>): {
    where(condition: Record<string, unknown>): Promise<unknown>;
  };
};

export interface MemoryEntryLocator {
  scope: MemoryEntryScope;
  scope_key?: string;
  key: string;
}

export interface MemoryEntryListInput {
  scope: MemoryEntryScope;
  scope_key?: string;
  limit?: number;
}

export interface MemoryEntryRepository {
  upsert(input: MemoryEntryUpsertInput): Promise<MemoryEntryRecord>;
  get(id: string): Promise<MemoryEntryRecord | null>;
  /** The live (non-expired) entry at scope/scope_key/key, if any. */
  find(locator: MemoryEntryLocator): Promise<MemoryEntryRecord | null>;
  /** BM25-ranked live entries matching `query`. */
  search(input: MemoryEntrySearchInput): Promise<MemoryEntryRecord[]>;
  /** Live entries in one scope, newest first (management view). */
  list(input: MemoryEntryListInput): Promise<MemoryEntryRecord[]>;
  /** Records that these entries were recalled (sets `last_used_at`). */
  markUsed(ids: readonly string[], at?: number): Promise<void>;
  delete(id: string): Promise<boolean>;
}

function rowToRecord(row: Record<string, unknown>): MemoryEntryRecord {
  return {
    id: String(row.id ?? ''),
    scope: (row.scope as MemoryEntryScope) ?? 'global',
    scope_key: String(row.scope_key ?? ''),
    key: String(row.key ?? ''),
    content: String(row.content ?? ''),
    tags: String(row.tags ?? '[]'),
    source: String(row.source ?? ''),
    confidence: Number(row.confidence ?? 1),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
    expires_at: row.expires_at != null ? Number(row.expires_at) : null,
    kind: normalizeMemoryKind(row.kind),
    source_turn: String(row.source_turn ?? ''),
    trust_level: normalizeMemoryTrustLevel(row.trust_level),
    task_id: String(row.task_id ?? ''),
    last_used_at: row.last_used_at != null ? Number(row.last_used_at) : null,
    history: String(row.history ?? '[]') || '[]',
  };
}

export function isMemoryEntryExpired(record: MemoryEntryRecord, now = Date.now()): boolean {
  return record.expires_at != null && record.expires_at > 0 && record.expires_at < now;
}

function filterAndRank(
  records: MemoryEntryRecord[],
  input: MemoryEntrySearchInput,
): MemoryEntryRecord[] {
  const now = Date.now();
  const limit = input.limit ?? 10;
  const visible = records
    .filter((r) => !isMemoryEntryExpired(r, now))
    .filter((r) => (input.scope ? r.scope === input.scope : true))
    .filter((r) => (input.scope_key ? r.scope_key === input.scope_key : true));
  return rankMemoryEntries(visible, input.query).slice(0, limit).map((hit) => hit.item);
}

function filterListed(records: MemoryEntryRecord[], input: MemoryEntryListInput): MemoryEntryRecord[] {
  const now = Date.now();
  return records
    .filter((r) => !isMemoryEntryExpired(r, now))
    .filter((r) => r.scope === input.scope && r.scope_key === (input.scope_key ?? ''))
    .sort((left, right) => right.updated_at - left.updated_at)
    .slice(0, input.limit ?? 50);
}

/** Fields replaced on a write to an existing entry; the old content moves to `history`. */
function updatePatch(existing: MemoryEntryRecord, input: MemoryEntryUpsertInput, now: number) {
  const contentChanged = existing.content !== input.content;
  return {
    content: input.content,
    tags: serializeMemoryTags(input.tags),
    source: input.source ?? existing.source,
    confidence: input.confidence ?? existing.confidence,
    updated_at: now,
    expires_at: input.expires_at !== undefined ? input.expires_at : existing.expires_at,
    kind: input.kind ?? existing.kind,
    source_turn: input.source_turn ?? existing.source_turn,
    trust_level: input.trust_level ?? existing.trust_level,
    task_id: input.task_id ?? existing.task_id,
    history: contentChanged ? appendMemoryHistory(existing) : existing.history,
  };
}

function newRecord(input: MemoryEntryUpsertInput, now: number): MemoryEntryRecord {
  return {
    id: randomUUID().slice(0, 12),
    scope: input.scope,
    scope_key: input.scope_key ?? '',
    key: input.key,
    content: input.content,
    tags: serializeMemoryTags(input.tags),
    source: input.source ?? '',
    confidence: input.confidence ?? 1,
    created_at: now,
    updated_at: now,
    expires_at: input.expires_at ?? null,
    kind: input.kind ?? 'user_fact',
    source_turn: input.source_turn ?? '',
    trust_level: input.trust_level ?? '',
    task_id: input.task_id ?? '',
    last_used_at: null,
    history: '[]',
  };
}

export class InMemoryMemoryEntryRepository implements MemoryEntryRepository {
  private entries = new Map<string, MemoryEntryRecord>();

  async upsert(input: MemoryEntryUpsertInput): Promise<MemoryEntryRecord> {
    const existing = this.#locate(input);
    const now = Date.now();
    if (existing) {
      const updated: MemoryEntryRecord = { ...existing, ...updatePatch(existing, input, now) };
      this.entries.set(existing.id, updated);
      return updated;
    }
    const record = newRecord(input, now);
    this.entries.set(record.id, record);
    return record;
  }

  async get(id: string): Promise<MemoryEntryRecord | null> {
    return this.entries.get(id) ?? null;
  }

  async find(locator: MemoryEntryLocator): Promise<MemoryEntryRecord | null> {
    const found = this.#locate(locator);
    return found && !isMemoryEntryExpired(found) ? found : null;
  }

  async search(input: MemoryEntrySearchInput): Promise<MemoryEntryRecord[]> {
    return filterAndRank([...this.entries.values()], input);
  }

  async list(input: MemoryEntryListInput): Promise<MemoryEntryRecord[]> {
    return filterListed([...this.entries.values()], input);
  }

  async markUsed(ids: readonly string[], at = Date.now()): Promise<void> {
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) this.entries.set(id, { ...entry, last_used_at: at });
    }
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  #locate(locator: MemoryEntryLocator): MemoryEntryRecord | undefined {
    const scopeKey = locator.scope_key ?? '';
    return [...this.entries.values()].find(
      (e) => e.scope === locator.scope && e.scope_key === scopeKey && e.key === locator.key,
    );
  }
}

export class DatabaseMemoryEntryRepository implements MemoryEntryRepository {
  constructor(private readonly model: DbModel) {}

  async upsert(input: MemoryEntryUpsertInput): Promise<MemoryEntryRecord> {
    const existing = await this.#locate(input);
    const now = Date.now();
    if (existing) {
      const patch = updatePatch(existing, input, now);
      await this.model.update(patch).where({ id: existing.id });
      return { ...existing, ...patch };
    }
    const record = newRecord(input, now);
    await this.model.create(record as unknown as Record<string, unknown>);
    return record;
  }

  async get(id: string): Promise<MemoryEntryRecord | null> {
    const rows = await this.model.select().where({ id });
    return rows.length ? rowToRecord(rows[0]!) : null;
  }

  async find(locator: MemoryEntryLocator): Promise<MemoryEntryRecord | null> {
    const found = await this.#locate(locator);
    return found && !isMemoryEntryExpired(found) ? found : null;
  }

  async search(input: MemoryEntrySearchInput): Promise<MemoryEntryRecord[]> {
    const where: Record<string, unknown> = {};
    if (input.scope) where.scope = input.scope;
    if (input.scope_key) where.scope_key = input.scope_key;
    const rows = await this.model.select().where(where);
    const records = rows.map(rowToRecord);
    return filterAndRank(records, input);
  }

  async list(input: MemoryEntryListInput): Promise<MemoryEntryRecord[]> {
    const rows = await this.model.select().where({ scope: input.scope, scope_key: input.scope_key ?? '' });
    return filterListed(rows.map(rowToRecord), input);
  }

  async markUsed(ids: readonly string[], at = Date.now()): Promise<void> {
    for (const id of ids) await this.model.update({ last_used_at: at }).where({ id });
  }

  async delete(id: string): Promise<boolean> {
    await this.model.update({ expires_at: 1 }).where({ id });
    return true;
  }

  async #locate(locator: MemoryEntryLocator): Promise<MemoryEntryRecord | null> {
    const rows = await this.model
      .select()
      .where({ scope: locator.scope, scope_key: locator.scope_key ?? '', key: locator.key });
    return rows.length ? rowToRecord(rows[0]!) : null;
  }
}

type AlterableDatabase = {
  alter(name: string, alterations: Record<string, unknown>): PromiseLike<unknown>;
};

/**
 * Lossless migration for tables created before #733: adds each missing column
 * with its default (ALTER TABLE … ADD COLUMN keeps every row). A column is
 * missing when selecting it fails; schemaless stores never fail and need
 * nothing. Readers normalize the empty defaults of legacy rows.
 */
export async function ensureMemoryEntryColumns(
  db: AlterableDatabase,
  model: DbModel,
  table = 'memory_entries',
): Promise<string[]> {
  const added: string[] = [];
  for (const [column, definition] of Object.entries(MEMORY_ENTRY_ADDED_COLUMNS)) {
    try {
      await model.select(column).where({ id: '__memory_schema_probe__' });
      continue;
    } catch {
      // Column is missing; add it below.
    }
    await db.alter(table, { [column]: { action: 'add', ...definition } });
    added.push(column);
  }
  return added;
}
