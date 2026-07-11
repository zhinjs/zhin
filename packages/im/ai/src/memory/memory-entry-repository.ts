/**
 * MemoryEntryRepository — CRUD + text search for semantic memory (L4).
 */
import { randomUUID } from 'node:crypto';
import { parseMemoryTags, serializeMemoryTags, type MemoryEntryRecord, type MemoryEntryScope, type MemoryEntrySearchInput, type MemoryEntryUpsertInput } from './memory-entry-models.js';

type DbModel = {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
  update(data: Record<string, unknown>): {
    where(condition: Record<string, unknown>): Promise<unknown>;
  };
};

export interface MemoryEntryRepository {
  upsert(input: MemoryEntryUpsertInput): Promise<MemoryEntryRecord>;
  get(id: string): Promise<MemoryEntryRecord | null>;
  search(input: MemoryEntrySearchInput): Promise<MemoryEntryRecord[]>;
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
  };
}

function matchesQuery(record: MemoryEntryRecord, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const tags = parseMemoryTags(record.tags).join(' ').toLowerCase();
  const hay = `${record.key} ${record.content} ${tags}`.toLowerCase();
  if (hay.includes(q)) return 10;
  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 2;
  }
  return score;
}

function isExpired(record: MemoryEntryRecord, now = Date.now()): boolean {
  return record.expires_at != null && record.expires_at > 0 && record.expires_at < now;
}

function filterAndRank(
  records: MemoryEntryRecord[],
  input: MemoryEntrySearchInput,
): MemoryEntryRecord[] {
  const now = Date.now();
  const limit = input.limit ?? 10;
  const scored = records
    .filter((r) => !isExpired(r, now))
    .filter((r) => (input.scope ? r.scope === input.scope : true))
    .filter((r) => (input.scope_key ? r.scope_key === input.scope_key : true))
    .map((r) => ({ record: r, score: matchesQuery(r, input.query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.record.updated_at - a.record.updated_at);
  return scored.slice(0, limit).map((x) => x.record);
}

export class InMemoryMemoryEntryRepository implements MemoryEntryRepository {
  private entries = new Map<string, MemoryEntryRecord>();

  async upsert(input: MemoryEntryUpsertInput): Promise<MemoryEntryRecord> {
    const scopeKey = input.scope_key ?? '';
    const existing = [...this.entries.values()].find(
      (e) => e.scope === input.scope && e.scope_key === scopeKey && e.key === input.key,
    );
    const now = Date.now();
    if (existing) {
      const updated: MemoryEntryRecord = {
        ...existing,
        content: input.content,
        tags: serializeMemoryTags(input.tags),
        source: input.source ?? existing.source,
        confidence: input.confidence ?? existing.confidence,
        updated_at: now,
        expires_at: input.expires_at !== undefined ? input.expires_at : existing.expires_at,
      };
      this.entries.set(existing.id, updated);
      return updated;
    }
    const record: MemoryEntryRecord = {
      id: randomUUID().slice(0, 12),
      scope: input.scope,
      scope_key: scopeKey,
      key: input.key,
      content: input.content,
      tags: serializeMemoryTags(input.tags),
      source: input.source ?? '',
      confidence: input.confidence ?? 1,
      created_at: now,
      updated_at: now,
      expires_at: input.expires_at ?? null,
    };
    this.entries.set(record.id, record);
    return record;
  }

  async get(id: string): Promise<MemoryEntryRecord | null> {
    return this.entries.get(id) ?? null;
  }

  async search(input: MemoryEntrySearchInput): Promise<MemoryEntryRecord[]> {
    return filterAndRank([...this.entries.values()], input);
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }
}

export class DatabaseMemoryEntryRepository implements MemoryEntryRepository {
  constructor(private readonly model: DbModel) {}

  async upsert(input: MemoryEntryUpsertInput): Promise<MemoryEntryRecord> {
    const scopeKey = input.scope_key ?? '';
    const rows = await this.model
      .select()
      .where({ scope: input.scope, scope_key: scopeKey, key: input.key });
    const now = Date.now();
    if (rows.length > 0) {
      const existing = rowToRecord(rows[0]!);
      const patch = {
        content: input.content,
        tags: serializeMemoryTags(input.tags),
        source: input.source ?? existing.source,
        confidence: input.confidence ?? existing.confidence,
        updated_at: now,
        expires_at: input.expires_at !== undefined ? input.expires_at : existing.expires_at,
      };
      await this.model.update(patch).where({ id: existing.id });
      return { ...existing, ...patch };
    }
    const record: MemoryEntryRecord = {
      id: randomUUID().slice(0, 12),
      scope: input.scope,
      scope_key: scopeKey,
      key: input.key,
      content: input.content,
      tags: serializeMemoryTags(input.tags),
      source: input.source ?? '',
      confidence: input.confidence ?? 1,
      created_at: now,
      updated_at: now,
      expires_at: input.expires_at ?? null,
    };
    await this.model.create(record as unknown as Record<string, unknown>);
    return record;
  }

  async get(id: string): Promise<MemoryEntryRecord | null> {
    const rows = await this.model.select().where({ id });
    return rows.length ? rowToRecord(rows[0]!) : null;
  }

  async search(input: MemoryEntrySearchInput): Promise<MemoryEntryRecord[]> {
    const where: Record<string, unknown> = {};
    if (input.scope) where.scope = input.scope;
    if (input.scope_key) where.scope_key = input.scope_key;
    const rows = await this.model.select().where(where);
    const records = rows.map(rowToRecord);
    return filterAndRank(records, input);
  }

  async delete(id: string): Promise<boolean> {
    await this.model.update({ expires_at: 1 }).where({ id });
    return true;
  }
}
