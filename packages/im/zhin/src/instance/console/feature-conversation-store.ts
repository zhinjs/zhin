/**
 * ADR 0055 §3: conversation-level feature overrides in the project database.
 *
 * The instance owns `feature_conversation_overrides` (no `console_` prefix: that namespace is
 * the gateway's). Rows load into memory at start; writes are serialized, compare-and-swap on
 * `revision`, write through to the database and bump `version`, which invalidates every
 * `configFor` / `isEnabledFor` / dispatch-gate cache in place (no reload, no restart).
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

export class FeatureConversationOverrideStore {
  readonly #database?: DatabaseHost;
  readonly #rows = new Map<string, FeatureConversationOverrideRow>();
  #version = 0;
  #queue: Promise<unknown> = Promise.resolve();
  #loaded = false;
  readonly reader: FeatureConversationOverrideReader;

  constructor(options: Readonly<{ database?: DatabaseHost }> = {}) {
    this.#database = options.database;
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

  /** Loads every row into memory; malformed rows are skipped (reported through `onInvalid`). */
  async load(onInvalid?: (id: string) => void): Promise<void> {
    const model = this.#model();
    this.#rows.clear();
    if (model) {
      const rows = await model.select(...FIELDS);
      for (const row of rows) {
        try {
          const patch = JSON.parse(String(row.patch)) as unknown;
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch');
          const value: FeatureConversationOverrideRow = deepFreeze({
            plugin: String(row.plugin), key: String(row.key),
            ...(Number(row.enabled) === 0 && row.enabled !== null && row.enabled !== undefined ? { enabled: false as const } : {}),
            patch: patch as Record<string, unknown>,
            revision: Number(row.revision), updatedAt: Number(row.updated_at),
            ...(typeof row.updated_by === 'string' && row.updated_by ? { updatedBy: row.updated_by } : {}),
          });
          if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new TypeError('revision');
          this.#rows.set(indexKey(value.plugin, value.key), value);
        } catch {
          onInvalid?.(String(row.id));
        }
      }
    }
    this.#loaded = true;
    this.#version += 1;
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
    const currentRevision = current?.revision ?? 0;
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      return Object.freeze({ status: 'conflict', revision: currentRevision });
    }
    const next = input.next(current);
    if (sameState(current, next)) {
      return Object.freeze({ status: 'unchanged', revision: currentRevision, ...(current ? { override: current } : {}) });
    }
    const id = rowId(input.plugin, input.key);
    const model = this.#model();
    if (!next) {
      if (model) await this.#persist(async target => {
        const [stored] = await target.select('revision').where({ id });
        if (Number(stored?.revision ?? 0) !== currentRevision) return false;
        await target.delete().where({ id, revision: currentRevision });
        return true;
      });
      this.#rows.delete(indexKey(input.plugin, input.key));
      this.#version += 1;
      return Object.freeze({ status: 'saved', revision: 0 });
    }
    const value: FeatureConversationOverrideRow = deepFreeze({
      plugin: input.plugin, key: input.key,
      ...(next.enabled === false ? { enabled: false as const } : {}),
      patch: structuredClone(next.patch) as Record<string, unknown>,
      revision: currentRevision + 1, updatedAt: Date.now(),
      ...(input.updatedBy ? { updatedBy: input.updatedBy.slice(0, 256) } : {}),
    });
    if (model) {
      const row = { plugin: value.plugin, key: value.key, enabled: value.enabled === false ? 0 : null, patch: JSON.stringify(value.patch),
        revision: value.revision, updated_at: value.updatedAt, updated_by: value.updatedBy ?? null };
      await this.#persist(async target => {
        const [stored] = await target.select('revision').where({ id });
        if (Number(stored?.revision ?? 0) !== currentRevision) return false;
        if (!stored) await target.insert({ id, ...row });
        else await target.update(row).where({ id, revision: currentRevision });
        return true;
      });
    }
    this.#rows.set(indexKey(value.plugin, value.key), value);
    this.#version += 1;
    return Object.freeze({ status: 'saved', revision: value.revision, override: value });
  }

  /** Runs one CAS step, inside a transaction when the database offers one. */
  async #persist(step: (model: DatabaseHostModel) => Promise<boolean>): Promise<void> {
    const database = this.#database!;
    const ok = database.transaction
      ? await database.transaction(transaction => step(transaction.model(FEATURE_CONVERSATION_TABLE)))
      : await step(this.#model()!);
    // Another process changed the row behind this cache: reload and let the caller retry.
    if (!ok) {
      await this.load();
      throw new FeatureConversationConflictError();
    }
  }
}

export class FeatureConversationConflictError extends Error {
  readonly code = 'revision_conflict';
  constructor() { super('Conversation override changed in the database; reloaded'); this.name = 'FeatureConversationConflictError'; }
}
