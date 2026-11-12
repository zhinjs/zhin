/**
 * ADR 0055 §3: conversation-level feature overrides in the project database.
 *
 * The instance owns `feature_conversation_overrides` (no `console_` prefix: that namespace is
 * the gateway's). Rows load into memory at start; writes are serialized, compare-and-swap on
 * `revision`, write through to the database and bump `version`, which invalidates every
 * `configFor` / `isEnabledFor` / dispatch-gate cache in place (no reload, no restart).
 *
 * Revisions are monotonic per (plugin, key): removing an override keeps a tombstone (a row with
 * an empty patch and no switch, which no live override can be) carrying the last revision, so a
 * re-created override continues from there and a stale compare-and-swap cannot succeed (no ABA).
 * Every database step checks its affected-row count; a row changed by another process (0 rows,
 * or a concurrent insert of the same key) reloads the cache and reports a conflict.
 */
import { createHash } from 'node:crypto';
import { assertInstanceTable } from '@zhin.js/database';
import type {
  DatabaseHost, DatabaseHostModel, FeatureConversationOverride, FeatureConversationOverrideReader,
} from '@zhin.js/plugin-runtime';

export const FEATURE_CONVERSATION_TABLE = 'feature_conversation_overrides';
const FIELDS = ['id', 'plugin', 'key', 'enabled', 'patch', 'revision', 'updated_at', 'updated_by'];
const RELATIONAL = ['sqlite', 'mysql', 'pg'];

/** Must run before the DatabaseHost starts. Non-relational dialects keep overrides in memory. */
export function defineFeatureConversationTable(database: DatabaseHost): void {
  assertInstanceTable(FEATURE_CONVERSATION_TABLE);
  if (!RELATIONAL.includes(database.dialect)) return;
  database.define(FEATURE_CONVERSATION_TABLE, {
    id: { type: 'text', length: 64, primary: true, nullable: false },
    plugin: { type: 'text', nullable: false },
    key: { type: 'text', nullable: false },
    // 0 = switched off; null = inherits. A lower level never stores "enabled".
    enabled: { type: 'integer', nullable: true },
    patch: { type: 'text', nullable: false },
    revision: { type: 'integer', nullable: false },
    updated_at: { type: 'bigint', nullable: false },
    updated_by: { type: 'text', nullable: true },
  });
}

export interface FeatureConversationOverrideRow extends FeatureConversationOverride {
  readonly plugin: string;
  readonly key: string;
}

export type FeatureConversationWriteResult =
  | Readonly<{ status: 'saved'; revision: number; override?: FeatureConversationOverrideRow }>
  | Readonly<{ status: 'unchanged'; revision: number; override?: FeatureConversationOverrideRow }>
  | Readonly<{ status: 'conflict'; revision: number }>;

export interface FeatureConversationWrite {
  readonly plugin: string;
  readonly key: string;
  /** Stored revision the caller read (`0` when none existed); omitted skips the check. */
  readonly expectedRevision?: number;
  /** Next state from the current one; `null` deletes the row. */
  readonly next: (current: FeatureConversationOverrideRow | undefined) => Readonly<{ enabled?: false; patch: Readonly<Record<string, unknown>> }> | null;
  readonly updatedBy?: string;
}

function rowId(plugin: string, key: string): string {
  return createHash('sha256').update(`${plugin}\0${key}`).digest('hex');
}

const indexKey = (plugin: string, key: string) => `${plugin}\0${key}`;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sameState(left: FeatureConversationOverrideRow | undefined, right: Readonly<{ enabled?: false; patch: Readonly<Record<string, unknown>> }> | null): boolean {
  if (!left || !right) return !left && !right;
  return (left.enabled === false) === (right.enabled === false) && JSON.stringify(left.patch) === JSON.stringify(right.patch);
}

/** Affected-row count of an update / delete; undefined when the host does not report one. */
function affectedRows(result: unknown): number | undefined {
  if (typeof result === 'number') return result;
  if (typeof result === 'bigint') return Number(result);
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const value = (result as { affectedRows?: unknown; changes?: unknown; rowCount?: unknown });
    for (const count of [value.affectedRows, value.changes, value.rowCount]) if (typeof count === 'number') return count;
  }
  return undefined;
}

/** Unique / primary key violation across sqlite, mysql and pg drivers. */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, errno, message } = error as { code?: unknown; errno?: unknown; message?: unknown };
  if (code === '23505' || code === 'ER_DUP_ENTRY' || errno === 1062) return true;
  if (typeof code === 'string' && /^SQLITE_CONSTRAINT(?:_PRIMARYKEY|_UNIQUE)?$/u.test(code)) return true;
  return typeof message === 'string' && /UNIQUE constraint failed|duplicate key value|Duplicate entry/iu.test(message);
}

/** Minimum interval between Console-driven reloads of the database (other processes' writes). */
const REFRESH_INTERVAL_MS = 5_000;

export class FeatureConversationOverrideStore {
  readonly #database?: DatabaseHost;
  readonly #rows = new Map<string, FeatureConversationOverrideRow>();
  /** Last revision of removed overrides (tombstones), so revisions never restart. */
  readonly #tombstones = new Map<string, number>();
  #version = 0;
  #loadedAt = 0;
  readonly #now: () => number;
  #queue: Promise<unknown> = Promise.resolve();
  #loaded = false;
  readonly reader: FeatureConversationOverrideReader;

  constructor(options: Readonly<{ database?: DatabaseHost; now?: () => number }> = {}) {
    this.#database = options.database;
    this.#now = options.now ?? Date.now;
    const store = this;
    this.reader = Object.freeze({
      get version() { return store.#version; },
      get: (plugin: string, key: string) => store.get(plugin, key),
    });
  }

  get version(): number { return this.#version; }
  /** False when overrides are kept only in memory (no relational database). */
  get persistent(): boolean { return !!this.#model(); }

  #model(): DatabaseHostModel | undefined {
    const database = this.#database;
    if (!database?.started || !RELATIONAL.includes(database.dialect)) return undefined;
    return database.models.get(FEATURE_CONVERSATION_TABLE);
  }

  /**
   * Loads every row into memory; malformed rows are skipped (reported through `onInvalid`).
   * `version` is bumped only when the content changed (or on the first load).
   */
  async load(onInvalid?: (id: string) => void): Promise<void> {
    const model = this.#model();
    if (!model) {
      // Memory only: nothing to read back.
      if (!this.#loaded) this.#version += 1;
      this.#loaded = true;
      this.#loadedAt = this.#now();
      return;
    }
    const rows = await model.select(...FIELDS);
    const nextRows = new Map<string, FeatureConversationOverrideRow>();
    const nextTombstones = new Map<string, number>();
    for (const row of rows) {
      try {
        const patch = JSON.parse(String(row.patch)) as unknown;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch');
        const switchedOff = Number(row.enabled) === 0 && row.enabled !== null && row.enabled !== undefined;
        if (!switchedOff && Object.keys(patch).length === 0) {
          const revision = Number(row.revision);
          if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('revision');
          nextTombstones.set(indexKey(String(row.plugin), String(row.key)), revision);
          continue;
        }
        const value: FeatureConversationOverrideRow = deepFreeze({
          plugin: String(row.plugin), key: String(row.key),
          ...(Number(row.enabled) === 0 && row.enabled !== null && row.enabled !== undefined ? { enabled: false as const } : {}),
          patch: patch as Record<string, unknown>,
          revision: Number(row.revision), updatedAt: Number(row.updated_at),
          ...(typeof row.updated_by === 'string' && row.updated_by ? { updatedBy: row.updated_by } : {}),
        });
        if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new TypeError('revision');
        nextRows.set(indexKey(value.plugin, value.key), value);
      } catch {
        onInvalid?.(String(row.id));
      }
    }
    const changed = !this.#loaded || nextRows.size !== this.#rows.size
      || [...nextRows].some(([key, row]) => {
        const current = this.#rows.get(key);
        return !current || current.revision !== row.revision || current.updatedAt !== row.updatedAt;
      });
    this.#rows.clear();
    for (const [key, row] of nextRows) this.#rows.set(key, row);
    this.#tombstones.clear();
    for (const [key, revision] of nextTombstones) this.#tombstones.set(key, revision);
    this.#loaded = true;
    this.#loadedAt = this.#now();
    if (changed) this.#version += 1;
  }

  /**
   * Picks up writes made by other processes sharing the database: a full reload, at most once per
   * {@link REFRESH_INTERVAL_MS}, queued behind pending writes. Called from Console read paths; a
   * failed reload keeps the current cache.
   */
  refresh(force = false): Promise<void> {
    if (!this.persistent || !this.#loaded || (!force && this.#now() - this.#loadedAt < REFRESH_INTERVAL_MS)) return Promise.resolve();
    const run = this.#queue.then(() => this.load()).catch(() => undefined);
    this.#queue = run;
    return run;
  }

  /** Current revision of (plugin, key): the row's, a tombstone's, or 0 when never written. */
  revisionOf(plugin: string, key: string): number {
    return this.get(plugin, key)?.revision ?? this.#tombstones.get(indexKey(plugin, key)) ?? 0;
  }

  get loaded(): boolean { return this.#loaded; }

  get(plugin: string, key: string): FeatureConversationOverrideRow | undefined {
    return this.#rows.get(indexKey(plugin, key));
  }

  list(): readonly FeatureConversationOverrideRow[] {
    return [...this.#rows.values()];
  }

  /** Serialized compare-and-swap write; memory changes only after the database accepted it. */
  write(input: FeatureConversationWrite): Promise<FeatureConversationWriteResult> {
    const run = this.#queue.then(() => this.#write(input));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #write(input: FeatureConversationWrite): Promise<FeatureConversationWriteResult> {
    const current = this.get(input.plugin, input.key);
    const currentRevision = this.revisionOf(input.plugin, input.key);
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      return Object.freeze({ status: 'conflict', revision: currentRevision });
    }
    const next = input.next(current);
    if (sameState(current, next)) {
      return Object.freeze({ status: 'unchanged', revision: currentRevision, ...(current ? { override: current } : {}) });
    }
    const id = rowId(input.plugin, input.key);
    const model = this.#model();
    const revision = currentRevision + 1;
    const updatedAt = this.#now();
    const updatedBy = input.updatedBy ? input.updatedBy.slice(0, 256) : undefined;
    if (model) {
      // Removal stores a tombstone (empty patch, no switch) that keeps the revision monotonic.
      const row = next
        ? { plugin: input.plugin, key: input.key, enabled: next.enabled === false ? 0 : null, patch: JSON.stringify(next.patch),
          revision, updated_at: updatedAt, updated_by: updatedBy ?? null }
        : { plugin: input.plugin, key: input.key, enabled: null, patch: '{}', revision, updated_at: updatedAt, updated_by: updatedBy ?? null };
      await this.#persist(async target => {
        const [stored] = await target.select('revision').where({ id });
        if (Number(stored?.revision ?? 0) !== currentRevision) return false;
        if (!stored) {
          await target.insert({ id, ...row });
          return true;
        }
        // CAS on the revision: 0 rows means another process won the race.
        const changed = affectedRows(await target.update(row).where({ id, revision: currentRevision }));
        return changed === undefined || changed === 1;
      });
    }
    const key = indexKey(input.plugin, input.key);
    if (!next) {
      this.#rows.delete(key);
      this.#tombstones.set(key, revision);
      this.#version += 1;
      return Object.freeze({ status: 'saved', revision });
    }
    const value: FeatureConversationOverrideRow = deepFreeze({
      plugin: input.plugin, key: input.key,
      ...(next.enabled === false ? { enabled: false as const } : {}),
      patch: structuredClone(next.patch) as Record<string, unknown>,
      revision, updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    });
    this.#rows.set(key, value);
    this.#tombstones.delete(key);
    this.#version += 1;
    return Object.freeze({ status: 'saved', revision: value.revision, override: value });
  }

  /** Runs one CAS step, inside a transaction when the database offers one. */
  async #persist(step: (model: DatabaseHostModel) => Promise<boolean>): Promise<void> {
    const database = this.#database!;
    let ok: boolean;
    try {
      ok = database.transaction
        ? await database.transaction(transaction => step(transaction.model(FEATURE_CONVERSATION_TABLE)))
        : await step(this.#model()!);
    } catch (error) {
      // A concurrent insert of the same key from another process: same as a lost CAS.
      if (!isUniqueViolation(error)) throw error;
      ok = false;
    }
    // Another process changed the row behind this cache: reload and let the caller retry.
    if (!ok) {
      try { await this.load(); } catch { /* the conflict is reported either way */ }
      throw new FeatureConversationConflictError();
    }
  }
}

export class FeatureConversationConflictError extends Error {
  readonly code = 'revision_conflict';
  constructor() { super('Conversation override changed in the database; reloaded'); this.name = 'FeatureConversationConflictError'; }
}
