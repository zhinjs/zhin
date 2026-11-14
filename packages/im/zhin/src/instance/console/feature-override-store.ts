/**
 * ADR 0057 §2 (generalizing ADR 0055 §3): adapter / endpoint / conversation feature overrides
 * in the project database.
 *
 * The instance owns `feature_overrides` (no `console_` prefix: that namespace is the gateway's).
 * One row per (plugin, level, key); the level is implied by the resolution key (`qq` adapter,
 * `qq/bot-1` endpoint, `qq/bot-1/group:1` conversation) and stored in its own column. The global
 * level is not stored here: the Plugin config block in the configuration file is the global
 * default and `disable_plugins` the global switch.
 *
 * Rows load into memory at start; writes are serialized, compare-and-swap on `revision`, write
 * through to the database and bump `version`, which invalidates every `configFor` /
 * `isEnabledFor` / dispatch-gate cache in place (no reload, no restart).
 *
 * Revisions are monotonic per (plugin, key): removing an override keeps a tombstone (a row with
 * an empty patch and no switch, which no live override can be) carrying the last revision, so a
 * re-created override continues from there and a stale compare-and-swap cannot succeed (no ABA).
 * Every database step checks its affected-row count; a row changed by another process (0 rows,
 * or a concurrent insert of the same key) reloads the cache and reports a conflict.
 *
 * With a project database that cannot persist rows (MongoDB, Redis, memory dialects) every write
 * is refused ({@link FeatureOverrideStorageUnavailableError}), never kept in memory and reported
 * as saved. Without a database at all the store is an explicit in-memory store (tests).
 *
 * Earlier releases kept conversation rows in `feature_conversation_overrides`. That table is still
 * defined (same shape, so an existing table is untouched) and read once at the first load: each of
 * its rows is copied with `level = 'conversation'` unless `feature_overrides` already has a row
 * (or a tombstone) for that key, which makes the copy idempotent. The old table is never written
 * again; it stays in place as a read-only record and may be dropped by hand.
 *
 * Writer (#1250): `updated_by` keeps the writer id (`chat:<adapter>:<userId>`, `user:<id>`, …).
 * A write that knows more about its operator (display name, source chat / console / cli) stores
 * a JSON object `{"f":1,"by":<id>,"op":{…}}` in the same text column, so no schema change is
 * needed. Reads accept both forms: a plain id (every row written before #1250, and the legacy
 * table) yields `updatedBy` plus whatever the id itself encodes; an unreadable value is kept as
 * the plain id and never fails the load.
 */
import { createHash } from 'node:crypto';
import { assertInstanceTable } from '@zhin.js/database';
import type { ConsoleFeatureOverrideOperator, ConsoleFeatureOverrideSource } from '@zhin.js/console-protocol';
import {
  featureKeyLevel,
  type DatabaseHost, type DatabaseHostModel, type FeatureConfigLevel, type FeatureConversationOverride, type FeatureConversationOverrideReader,
} from '@zhin.js/plugin-runtime';

export const FEATURE_OVERRIDE_TABLE = 'feature_overrides';
/** ADR 0055 table, read once to copy its rows (see the module comment). */
export const LEGACY_FEATURE_CONVERSATION_TABLE = 'feature_conversation_overrides';
export type FeatureOverrideLevel = Exclude<FeatureConfigLevel, 'global'>;
export const FEATURE_OVERRIDE_LEVELS: readonly FeatureOverrideLevel[] = Object.freeze(['adapter', 'endpoint', 'conversation']);
const FIELDS = ['id', 'plugin', 'level', 'key', 'enabled', 'patch', 'revision', 'updated_at', 'updated_by'];
const LEGACY_FIELDS = ['id', 'plugin', 'key', 'enabled', 'patch', 'revision', 'updated_at', 'updated_by'];
const RELATIONAL = ['sqlite', 'mysql', 'pg'];

const LEGACY_DEFINITION = Object.freeze({
  id: { type: 'text', length: 64, primary: true, nullable: false },
  plugin: { type: 'text', nullable: false },
  key: { type: 'text', nullable: false },
  enabled: { type: 'integer', nullable: true },
  patch: { type: 'text', nullable: false },
  revision: { type: 'integer', nullable: false },
  updated_at: { type: 'bigint', nullable: false },
  updated_by: { type: 'text', nullable: true },
});

/** Must run before the DatabaseHost starts. Non-relational dialects define nothing (writes are refused). */
export function defineFeatureOverrideTable(database: DatabaseHost): void {
  assertInstanceTable(FEATURE_OVERRIDE_TABLE);
  assertInstanceTable(LEGACY_FEATURE_CONVERSATION_TABLE);
  if (!RELATIONAL.includes(database.dialect)) return;
  database.define(FEATURE_OVERRIDE_TABLE, {
    id: { type: 'text', length: 64, primary: true, nullable: false },
    plugin: { type: 'text', nullable: false },
    // adapter | endpoint | conversation
    level: { type: 'text', nullable: false },
    key: { type: 'text', nullable: false },
    // 0 = switched off; null = inherits. A level below global never stores "enabled".
    enabled: { type: 'integer', nullable: true },
    patch: { type: 'text', nullable: false },
    revision: { type: 'integer', nullable: false },
    updated_at: { type: 'bigint', nullable: false },
    updated_by: { type: 'text', nullable: true },
  });
  database.define(LEGACY_FEATURE_CONVERSATION_TABLE, structuredClone(LEGACY_DEFINITION) as Record<string, unknown>);
}

export interface FeatureOverrideRow extends FeatureConversationOverride {
  readonly plugin: string;
  readonly level: FeatureOverrideLevel;
  readonly key: string;
  /** Structured writer, when the write recorded one or the legacy id encodes it. */
  readonly operator?: ConsoleFeatureOverrideOperator;
}

export type FeatureOverrideOperator = ConsoleFeatureOverrideOperator;

const SOURCES: ReadonlySet<ConsoleFeatureOverrideSource> = new Set(['chat', 'console', 'cli']);
const WRITER_FORMAT = 1;

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

/** Keeps only the known, bounded fields; undefined without a valid source. */
export function normalizeOverrideOperator(value: unknown): FeatureOverrideOperator | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (!SOURCES.has(input.source as ConsoleFeatureOverrideSource)) return undefined;
  const adapter = boundedText(input.adapter, 64);
  const userId = boundedText(input.userId, 128);
  const principalId = boundedText(input.principalId, 128);
  const displayName = boundedText(input.displayName, 64);
  return Object.freeze({ source: input.source as ConsoleFeatureOverrideSource,
    ...(adapter ? { adapter } : {}), ...(userId ? { userId } : {}),
    ...(principalId ? { principalId } : {}), ...(displayName ? { displayName } : {}) });
}

/** What a pre-#1250 writer id tells about its operator (`migration:*` and unknown ids: nothing). */
export function operatorFromWriterId(updatedBy: string | undefined): FeatureOverrideOperator | undefined {
  if (!updatedBy) return undefined;
  const chat = /^chat:([^:]+):(.+)$/u.exec(updatedBy);
  if (chat) return normalizeOverrideOperator({ source: 'chat', adapter: chat[1], userId: chat[2] });
  const user = /^user:(.+)$/u.exec(updatedBy);
  if (user) return normalizeOverrideOperator({ source: 'console', principalId: user[1] });
  if (updatedBy === 'bootstrap' || updatedBy.startsWith('api-token:')) return Object.freeze({ source: 'console' as const });
  return undefined;
}

/** `updated_by` column value: the plain id, or the structured form when an operator is known. */
export function encodeOverrideWriter(updatedBy: string | undefined, operator: FeatureOverrideOperator | undefined): string | null {
  const id = updatedBy ? updatedBy.slice(0, 256) : undefined;
  const op = normalizeOverrideOperator(operator);
  if (!op) return id ?? null;
  return JSON.stringify({ f: WRITER_FORMAT, ...(id ? { by: id } : {}), op });
}

/** Reads either `updated_by` form; never throws (an unreadable value stays a plain id). */
export function decodeOverrideWriter(raw: unknown): { readonly updatedBy?: string; readonly operator?: FeatureOverrideOperator } {
  if (typeof raw !== 'string' || !raw) return {};
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.f === WRITER_FORMAT) {
        const updatedBy = typeof parsed.by === 'string' && parsed.by ? parsed.by : undefined;
        const operator = normalizeOverrideOperator(parsed.op) ?? operatorFromWriterId(updatedBy);
        return { ...(updatedBy ? { updatedBy } : {}), ...(operator ? { operator } : {}) };
      }
    } catch { /* not the structured form: a plain id that happens to start with a brace */ }
  }
  const operator = operatorFromWriterId(raw);
  return { updatedBy: raw, ...(operator ? { operator } : {}) };
}

export type FeatureOverrideWriteResult =
  | Readonly<{ status: 'saved'; revision: number; override?: FeatureOverrideRow }>
  | Readonly<{ status: 'unchanged'; revision: number; override?: FeatureOverrideRow }>
  | Readonly<{ status: 'conflict'; revision: number }>;

export interface FeatureOverrideState {
  readonly enabled?: false;
  readonly patch: Readonly<Record<string, unknown>>;
}

export interface FeatureOverrideWrite {
  readonly plugin: string;
  /** Resolution key of an adapter, endpoint or conversation (never `''`, the global level). */
  readonly key: string;
  /** Stored revision the caller read (`0` when none existed); omitted skips the check. */
  readonly expectedRevision?: number;
  /** Next state from the current one; `null` deletes the override. */
  readonly next: (current: FeatureOverrideRow | undefined) => FeatureOverrideState | null;
  readonly updatedBy?: string;
  /** Structured writer (#1250); stored with `updatedBy` in the same column. */
  readonly operator?: FeatureOverrideOperator;
}

/** Level a stored key addresses; throws for the global key and malformed keys. */
export function featureOverrideLevel(key: string): FeatureOverrideLevel {
  const level = featureKeyLevel(key);
  if (level === 'global') throw new TypeError('The global level is the configuration file, not a stored override');
  return level;
}

/** Primary key of one (plugin, level, key) row. */
export function featureOverrideRowId(plugin: string, level: FeatureOverrideLevel, key: string): string {
  return createHash('sha256').update(`${plugin}\0${level}\0${key}`).digest('hex');
}

/** ADR 0055 row id of `feature_conversation_overrides` (plugin, key). */
function legacyRowId(plugin: string, key: string): string {
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

function sameState(left: FeatureOverrideRow | undefined, right: FeatureOverrideState | null): boolean {
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

interface ParsedRow {
  readonly key: string;
  readonly plugin: string;
  /** Live override, or undefined for a tombstone. */
  readonly row?: FeatureOverrideRow;
  readonly revision: number;
}

function parseRow(row: Record<string, unknown>, level: FeatureOverrideLevel | undefined): ParsedRow {
  const plugin = String(row.plugin);
  const key = String(row.key);
  const derived = featureOverrideLevel(key);
  if (level !== undefined && level !== derived) throw new TypeError('level');
  const patch = JSON.parse(String(row.patch)) as unknown;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch');
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('revision');
  const switchedOff = Number(row.enabled) === 0 && row.enabled !== null && row.enabled !== undefined;
  if (!switchedOff && Object.keys(patch).length === 0) return { plugin, key, revision };
  const value: FeatureOverrideRow = deepFreeze({
    plugin, level: derived, key,
    ...(switchedOff ? { enabled: false as const } : {}),
    patch: patch as Record<string, unknown>,
    revision, updatedAt: Number(row.updated_at),
    ...decodeOverrideWriter(row.updated_by),
  });
  return { plugin, key, row: value, revision };
}

export class FeatureOverrideStore {
  readonly #database?: DatabaseHost;
  readonly #rows = new Map<string, FeatureOverrideRow>();
  /** Last revision of removed overrides (tombstones), so revisions never restart. */
  readonly #tombstones = new Map<string, number>();
  #version = 0;
  #loadedAt = 0;
  readonly #now: () => number;
  #queue: Promise<unknown> = Promise.resolve();
  #loaded = false;
  #legacyCopied = false;
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

  /**
   * Whether writes are saved: true with a relational project database (and for the explicit
   * in-memory store without a database); false when the database cannot persist rows, in which
   * case every write is refused.
   */
  get persistent(): boolean { return !this.#database || !!this.#model(); }

  #model(): DatabaseHostModel | undefined {
    const database = this.#database;
    if (!database?.started || !RELATIONAL.includes(database.dialect)) return undefined;
    return database.models.get(FEATURE_OVERRIDE_TABLE);
  }

  /**
   * Loads every row into memory; malformed rows are skipped (reported through `onInvalid`).
   * `version` is bumped only when the content changed (or on the first load). The first load also
   * copies the ADR 0055 conversation rows (see the module comment).
   */
  async load(onInvalid?: (id: string) => void): Promise<void> {
    const model = this.#model();
    if (!model) {
      // In-memory store (or a database that cannot persist): nothing to read back.
      if (!this.#loaded) this.#version += 1;
      this.#loaded = true;
      this.#loadedAt = this.#now();
      return;
    }
    let rows = await model.select(...FIELDS);
    if (!this.#legacyCopied) {
      if (await this.#copyLegacyRows(model, rows, onInvalid)) rows = await model.select(...FIELDS);
      this.#legacyCopied = true;
    }
    const nextRows = new Map<string, FeatureOverrideRow>();
    const nextTombstones = new Map<string, number>();
    for (const row of rows) {
      try {
        const level = row.level;
        if (!FEATURE_OVERRIDE_LEVELS.includes(level as FeatureOverrideLevel)) throw new TypeError('level');
        const parsed = parseRow(row, level as FeatureOverrideLevel);
        if (parsed.row) nextRows.set(indexKey(parsed.plugin, parsed.key), parsed.row);
        else nextTombstones.set(indexKey(parsed.plugin, parsed.key), parsed.revision);
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

  /** Copies ADR 0055 conversation rows that `feature_overrides` does not know yet; true when any was copied. */
  async #copyLegacyRows(model: DatabaseHostModel, current: readonly Record<string, unknown>[], onInvalid?: (id: string) => void): Promise<boolean> {
    const legacy = this.#database!.models.get(LEGACY_FEATURE_CONVERSATION_TABLE);
    if (!legacy) return false;
    const known = new Set(current.map(row => String(row.id)));
    let copied = false;
    for (const row of await legacy.select(...LEGACY_FIELDS)) {
      try {
        const plugin = String(row.plugin);
        const key = String(row.key);
        if (String(row.id) !== legacyRowId(plugin, key) || featureOverrideLevel(key) !== 'conversation') throw new TypeError('key');
        parseRow(row, 'conversation');
        const id = featureOverrideRowId(plugin, 'conversation', key);
        if (known.has(id)) continue;
        try {
          await model.insert({ id, plugin, level: 'conversation', key, enabled: row.enabled ?? null, patch: String(row.patch),
            revision: Number(row.revision), updated_at: Number(row.updated_at), updated_by: row.updated_by ?? null });
          copied = true;
        } catch (error) {
          // Another process copied it first.
          if (!isUniqueViolation(error)) throw error;
        }
        known.add(id);
      } catch (error) {
        if (error instanceof TypeError || error instanceof SyntaxError) onInvalid?.(`${LEGACY_FEATURE_CONVERSATION_TABLE}:${String(row.id)}`);
        else throw error;
      }
    }
    return copied;
  }

  /**
   * Picks up writes made by other processes sharing the database: a full reload, at most once per
   * {@link REFRESH_INTERVAL_MS}, queued behind pending writes. Called from Console read paths; a
   * failed reload keeps the current cache.
   */
  refresh(force = false): Promise<void> {
    if (!this.#model() || !this.#loaded || (!force && this.#now() - this.#loadedAt < REFRESH_INTERVAL_MS)) return Promise.resolve();
    const run = this.#queue.then(() => this.load()).catch(() => undefined);
    this.#queue = run;
    return run;
  }

  /** Current revision of (plugin, key): the row's, a tombstone's, or 0 when never written. */
  revisionOf(plugin: string, key: string): number {
    return this.get(plugin, key)?.revision ?? this.#tombstones.get(indexKey(plugin, key)) ?? 0;
  }

  get loaded(): boolean { return this.#loaded; }

  get(plugin: string, key: string): FeatureOverrideRow | undefined {
    return this.#rows.get(indexKey(plugin, key));
  }

  /** Every live override, optionally of one level. */
  list(level?: FeatureOverrideLevel): readonly FeatureOverrideRow[] {
    const rows = [...this.#rows.values()];
    return level ? rows.filter(row => row.level === level) : rows;
  }

  /**
   * Memory-only overrides (the configuration migration on a database that cannot persist rows):
   * effective until the process exits, never written; existing rows and tombstones are kept.
   */
  seed(entries: readonly (FeatureOverrideState & Readonly<{ plugin: string; key: string; updatedBy?: string }>)[]): number {
    let added = 0;
    for (const entry of entries) {
      let level: FeatureOverrideLevel;
      try { level = featureOverrideLevel(entry.key); } catch { continue; }
      const key = indexKey(entry.plugin, entry.key);
      if (this.#rows.has(key) || this.#tombstones.has(key)) continue;
      if (entry.enabled !== false && Object.keys(entry.patch).length === 0) continue;
      this.#rows.set(key, deepFreeze({
        plugin: entry.plugin, level, key: entry.key,
        ...(entry.enabled === false ? { enabled: false as const } : {}),
        patch: structuredClone(entry.patch) as Record<string, unknown>,
        revision: 1, updatedAt: this.#now(),
        ...(entry.updatedBy ? { updatedBy: entry.updatedBy } : {}),
      }));
      added += 1;
    }
    if (added) this.#version += 1;
    return added;
  }

  /** Serialized compare-and-swap write; memory changes only after the database accepted it. */
  write(input: FeatureOverrideWrite): Promise<FeatureOverrideWriteResult> {
    const run = this.#queue.then(() => this.#write(input));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #write(input: FeatureOverrideWrite): Promise<FeatureOverrideWriteResult> {
    const level = featureOverrideLevel(input.key);
    const current = this.get(input.plugin, input.key);
    const currentRevision = this.revisionOf(input.plugin, input.key);
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      return Object.freeze({ status: 'conflict', revision: currentRevision });
    }
    const next = input.next(current);
    if (sameState(current, next)) {
      return Object.freeze({ status: 'unchanged', revision: currentRevision, ...(current ? { override: current } : {}) });
    }
    const model = this.#model();
    // A database that cannot persist rows: refuse instead of reporting an in-memory save.
    if (this.#database && !model) throw new FeatureOverrideStorageUnavailableError();
    const id = featureOverrideRowId(input.plugin, level, input.key);
    const revision = currentRevision + 1;
    const updatedAt = this.#now();
    const updatedBy = input.updatedBy ? input.updatedBy.slice(0, 256) : undefined;
    const operator = normalizeOverrideOperator(input.operator) ?? operatorFromWriterId(updatedBy);
    if (model) {
      // Removal stores a tombstone (empty patch, no switch) that keeps the revision monotonic.
      const row = { plugin: input.plugin, level, key: input.key,
        enabled: next?.enabled === false ? 0 : null, patch: next ? JSON.stringify(next.patch) : '{}',
        revision, updated_at: updatedAt, updated_by: encodeOverrideWriter(updatedBy, normalizeOverrideOperator(input.operator)) };
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
    const value: FeatureOverrideRow = deepFreeze({
      plugin: input.plugin, level, key: input.key,
      ...(next.enabled === false ? { enabled: false as const } : {}),
      patch: structuredClone(next.patch) as Record<string, unknown>,
      revision, updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
      ...(operator ? { operator } : {}),
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
        ? await database.transaction(transaction => step(transaction.model(FEATURE_OVERRIDE_TABLE)))
        : await step(this.#model()!);
    } catch (error) {
      // A concurrent insert of the same key from another process: same as a lost CAS.
      if (!isUniqueViolation(error)) throw error;
      ok = false;
    }
    // Another process changed the row behind this cache: reload and let the caller retry.
    if (!ok) {
      try { await this.load(); } catch { /* the conflict is reported either way */ }
      throw new FeatureOverrideConflictError();
    }
  }
}

export class FeatureOverrideConflictError extends Error {
  readonly code = 'revision_conflict';
  constructor() { super('Feature override changed in the database; reloaded'); this.name = 'FeatureOverrideConflictError'; }
}

/**
 * ADR 0057 §2 (same rule as ADR 0056 §3): feature overrides must survive a restart. Without a
 * relational project database the store refuses writes instead of keeping them in memory.
 */
export class FeatureOverrideStorageUnavailableError extends Error {
  readonly code = 'feature-overrides-unpersisted';
  constructor() {
    super('功能覆盖需要关系型项目数据库（sqlite / mysql / pg）才能保存；当前数据库不支持，未保存。');
    this.name = 'FeatureOverrideStorageUnavailableError';
  }
}
