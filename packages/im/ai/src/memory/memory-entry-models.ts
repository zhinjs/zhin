/**
 * Semantic memory entries — L4 structured recall (no vector v1).
 *
 * Data model (#733):
 * - `scope` / `scope_key` — where the entry is visible.
 * - `kind` — what the entry is: a stable user fact, a preference, temporary
 *   task state, or an episodic note. Task state expires with its task.
 * - `source` / `source_turn` / `trust_level` — who wrote it, from which turn,
 *   at which initiator trust level. Set by the writer, never by model input.
 * - `created_at` / `updated_at` / `expires_at` / `last_used_at` — lifecycle.
 * - `history` — previous versions kept when a newer write replaces content.
 *
 * Rows written before #733 have empty `kind` / `trust_level`; readers
 * normalize them (see {@link normalizeMemoryKind}) so existing data keeps
 * working without a rewrite.
 */

export type MemoryEntryScope = 'global' | 'platform' | 'session' | 'user';

export const MEMORY_ENTRY_KINDS = ['user_fact', 'preference', 'task_state', 'episodic'] as const;
export type MemoryEntryKind = (typeof MEMORY_ENTRY_KINDS)[number];

/** Trust level of the writer; mirrors the agent's initiator levels. Empty for legacy rows. */
export type MemoryEntryTrustLevel = 'owner' | 'trusted_member' | 'group_member' | '';

/** Previous versions kept per entry when content is replaced. */
export const MEMORY_ENTRY_HISTORY_LIMIT = 5;

/** Columns added by #733. Existing tables gain them through `ensureMemoryEntryColumns`. */
export const MEMORY_ENTRY_ADDED_COLUMNS = {
  kind: { type: 'text' as const, default: '' },
  source_turn: { type: 'text' as const, default: '' },
  trust_level: { type: 'text' as const, default: '' },
  task_id: { type: 'text' as const, default: '' },
  last_used_at: { type: 'bigint' as const, nullable: true },
  history: { type: 'text' as const, default: '[]' },
};

export const MEMORY_ENTRY_MODEL = {
  id: { type: 'text' as const, nullable: false },
  scope: { type: 'text' as const, nullable: false },
  scope_key: { type: 'text' as const, default: '' },
  key: { type: 'text' as const, nullable: false },
  content: { type: 'text' as const, nullable: false },
  tags: { type: 'text' as const, default: '[]' },
  source: { type: 'text' as const, default: '' },
  confidence: { type: 'real' as const, default: 1 },
  created_at: { type: 'bigint' as const, default: 0 },
  updated_at: { type: 'bigint' as const, default: 0 },
  expires_at: { type: 'bigint' as const, nullable: true },
  ...MEMORY_ENTRY_ADDED_COLUMNS,
};

export interface MemoryEntryVersion {
  content: string;
  source: string;
  source_turn: string;
  trust_level: MemoryEntryTrustLevel;
  updated_at: number;
}

export interface MemoryEntryRecord {
  id: string;
  scope: MemoryEntryScope;
  scope_key: string;
  key: string;
  content: string;
  tags: string;
  source: string;
  confidence: number;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  kind: MemoryEntryKind;
  source_turn: string;
  trust_level: MemoryEntryTrustLevel;
  /** Task a `task_state` entry belongs to; empty when unbound. */
  task_id: string;
  last_used_at: number | null;
  /** JSON array of {@link MemoryEntryVersion}, newest first. */
  history: string;
}

export interface MemoryEntryUpsertInput {
  scope: MemoryEntryScope;
  scope_key?: string;
  key: string;
  content: string;
  tags?: string[];
  source?: string;
  confidence?: number;
  expires_at?: number | null;
  kind?: MemoryEntryKind;
  source_turn?: string;
  trust_level?: MemoryEntryTrustLevel;
  task_id?: string;
}

export interface MemoryEntrySearchInput {
  scope?: MemoryEntryScope;
  scope_key?: string;
  query: string;
  limit?: number;
}

export function parseMemoryTags(json: string): string[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function serializeMemoryTags(tags: string[] | undefined): string {
  return JSON.stringify(tags ?? []);
}

export function isMemoryEntryKind(value: unknown): value is MemoryEntryKind {
  return typeof value === 'string' && (MEMORY_ENTRY_KINDS as readonly string[]).includes(value);
}

/** Legacy rows (no kind) were written as durable facts by `memory_upsert`. */
export function normalizeMemoryKind(value: unknown): MemoryEntryKind {
  return isMemoryEntryKind(value) ? value : 'user_fact';
}

export function normalizeMemoryTrustLevel(value: unknown): MemoryEntryTrustLevel {
  return value === 'owner' || value === 'trusted_member' || value === 'group_member' ? value : '';
}

export function parseMemoryHistory(json: string): MemoryEntryVersion[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        content: String(item.content ?? ''),
        source: String(item.source ?? ''),
        source_turn: String(item.source_turn ?? ''),
        trust_level: normalizeMemoryTrustLevel(item.trust_level),
        updated_at: Number(item.updated_at ?? 0),
      }));
  } catch {
    return [];
  }
}

/** Prepends the replaced version, keeping at most {@link MEMORY_ENTRY_HISTORY_LIMIT}. */
export function appendMemoryHistory(record: MemoryEntryRecord): string {
  const previous: MemoryEntryVersion = {
    content: record.content,
    source: record.source,
    source_turn: record.source_turn,
    trust_level: record.trust_level,
    updated_at: record.updated_at,
  };
  return JSON.stringify([previous, ...parseMemoryHistory(record.history)].slice(0, MEMORY_ENTRY_HISTORY_LIMIT));
}

/** Readable Markdown export of entries (the structured store is the source of truth). */
export function renderMemoryEntriesMarkdown(records: readonly MemoryEntryRecord[]): string {
  if (records.length === 0) return '';
  const lines = ['# Memory', ''];
  for (const record of records) {
    const where = record.scope_key ? `${record.scope}:${record.scope_key}` : record.scope;
    const tags = parseMemoryTags(record.tags);
    lines.push(`- **${record.key}** (${record.kind}, ${where}): ${record.content}`
      + (tags.length ? ` — tags: ${tags.join(', ')}` : '')
      + (record.expires_at ? ` — expires ${new Date(record.expires_at).toISOString()}` : ''));
  }
  return lines.join('\n');
}
