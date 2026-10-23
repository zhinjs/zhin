import type { PluginId } from './identity.js';
import {
  OwnerScopedResourceHost,
  qualifyOwnedResourceName,
} from './owner-scoped-resource-host.js';
import { createRootPrivateToken, createToken, scopeSetupFinalizer } from './token.js';
import { PluginStateStore, type PersistentStatePort } from './persistent-state.js';
import { generationAdmissionBinder, generationAdmissionSource, type GenerationAdmissionGate } from './admission.js';
import { OwnerOperation } from './owner-operation.js';

export interface DatabaseHostSelection {
  where(query: Record<string, unknown>): DatabaseHostSelection;
  orderBy(field: string, direction?: 'ASC' | 'DESC'): DatabaseHostSelection;
  limit(count: number): DatabaseHostSelection;
  then<TResult1 = Record<string, unknown>[], TResult2 = never>(
    onfulfilled?: ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

/**
 * select() 需要显式列名：'*' 在 SQL 方言里会被当成字面列名（no such column: "*"），
 * 类型层直接拒绝；运行时另有可读报错兜底（见 Host 实现）。
 */
type SelectFields<Fields extends readonly string[]> = {
  [K in keyof Fields]: Fields[K] extends '*' ? never : Fields[K];
};

/**
 * Minimal model surface shared by lottery / rss / group-suite memory stores
 * and the Host-backed `@zhin.js/database` adapter.
 */
export interface DatabaseHostModel {
  select<Fields extends string[]>(...fields: SelectFields<Fields>): DatabaseHostSelection;
  insert(row: Record<string, unknown>): Promise<unknown>;
  delete(): { where(query: Record<string, unknown>): Promise<unknown> };
  update(patch: Record<string, unknown>): {
    where(query: Record<string, unknown>): Promise<unknown>;
  };
  /**
   * DB 侧计数（聚合下推，避免为计数整表加载）。
   * 可选：轻量 test/memory host 可不实现，调用方降级为 select 计数。
   */
  count?(where?: Record<string, unknown>): Promise<number>;
}

/** Callback-scoped transaction models; no raw SQL or administration access. */
export interface DatabaseHostTransaction {
  model(name: string): DatabaseHostModel;
}

export type DatabaseHostType = 'related' | 'document' | 'keyvalue';

export interface DatabaseHostTable {
  readonly name: string;
  readonly columns?: Readonly<Record<string, unknown>>;
}

export interface DatabaseHostSelectResult {
  readonly rows: readonly unknown[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Root-only database administration surface used by Console RPC. */
export interface DatabaseHostConsole {
  info(): {
    readonly dialect: string;
    readonly type: DatabaseHostType;
    readonly tables: readonly string[];
    readonly connected: boolean;
  };
  tables(): readonly DatabaseHostTable[];
  select(
    table: string,
    page: number,
    pageSize: number,
    where?: Record<string, unknown>,
  ): Promise<DatabaseHostSelectResult>;
  insert(table: string, row: Record<string, unknown>): Promise<void>;
  update(
    table: string,
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ): Promise<unknown>;
  delete(table: string, where: Record<string, unknown>): Promise<unknown>;
  dropTable(table: string): Promise<void>;
  kvGet(table: string, key: string): Promise<unknown>;
  kvSet(table: string, key: string, value: unknown, ttl?: number): Promise<void>;
  kvDelete(table: string, key: string): Promise<void>;
  kvEntries(table: string): Promise<readonly { key: string; value: unknown }[]>;
}

/**
 * Thin Host Resource for Plugin Runtime persistence.
 * Plugins call `define` during `setup()`; Host starts the dialect on generation
 * `activateNext` so models are available before commands / cron run.
 */
export interface DatabaseHost {
  /** Small-object persistence with database-level compare-and-swap. */
  readonly state?: PersistentStatePort;
  readonly dialect: string;
  readonly started: boolean;
  /** Register a table schema before `start` (column defs match `@zhin.js/database`). */
  define(name: string, definition: Record<string, unknown>): void;
  /** Names of tables registered via `define` (Console `db:tables`). */
  tables(): readonly string[];
  models: {
    get(name: string): DatabaseHostModel | undefined;
  };
  /** Atomic SQL operations. The callback must await all operations before returning. */
  transaction?<T>(callback: (transaction: DatabaseHostTransaction) => Promise<T>): Promise<T>;
  /** Root-only management port; absent on lightweight test/memory hosts. */
  readonly console?: DatabaseHostConsole;
  /**
   * Raw `@zhin.js/database` registry (full `create` / `select` API).
   * Available after `start()` — used by Agent Host ADR 0009 persistence.
   */
  getRawDatabase(): { models?: Map<string, unknown> } | undefined;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Persistence surface visible to a plugin. Names are logical to the owner;
 * the Runtime maps them to private physical table names before they reach the
 * process-wide DatabaseHost.
 */
/**
 * Maps a plugin's logical resource name to its process-wide physical name.
 * Every owner, including the root plugin, uses the same private namespace.
 */
export function qualifyPluginResourceName(owner: PluginId, name: string): string {
  return qualifyOwnedResourceName(owner, name);
}

/** Owner-bound persistence facade without Console administration or raw DB access. */
export class PluginDatabaseHost extends OwnerScopedResourceHost {
  readonly models: { get(name: string): DatabaseHostModel | undefined };

  readonly #host: DatabaseHost;
  readonly #admission?: GenerationAdmissionGate;
  readonly #operation: OwnerOperation;

  constructor(owner: PluginId, host: DatabaseHost, admission?: GenerationAdmissionGate) {
    super(owner);
    this.#host = host;
    this.#admission = admission;
    this.#operation = new OwnerOperation(admission, 'Database');
    this.models = Object.freeze({ get: (name: string) => this.#operation.setup(() => {
      const model = this.#host.models.get(this.qualify(name));
      return model ? this.#bindModel(model) : undefined;
    }) });
  }

  get state(): PluginStateStore {
    if (!this.#host.state) throw new Error('Persistent state requires a configured database with atomic state support');
    return new PluginStateStore(super.owner, this.#host.state, undefined, this.#admission);
  }

  /** @internal Bound by generation publication, never a plugin authoring operation. */
  [generationAdmissionBinder](gate: GenerationAdmissionGate): PluginDatabaseHost {
    const facade = new PluginDatabaseHost(super.owner, this.#host, gate);
    facade[scopeSetupFinalizer]();
    return facade;
  }

  /** @internal Scope-owned declaration window. */
  [scopeSetupFinalizer](): void { this.#operation.endSetup(); }

  /** @internal Admission source collected by the Runtime. */
  get [generationAdmissionSource](): readonly GenerationAdmissionGate[] {
    return this.#admission ? [this.#admission] : [];
  }

  get dialect(): string {
    return this.#host.dialect;
  }

  get started(): boolean {
    return this.#host.started;
  }

  define(name: string, definition: Record<string, unknown>): void {
    this.#operation.setup(() => this.#host.define(this.qualify(name), definition));
  }

  tables(): readonly string[] {
    return this.#operation.setup(() => Object.freeze(this.#host.tables().flatMap((name) => {
      const logical = this.unqualify(name);
      return logical === undefined ? [] : [logical];
    })));
  }

  async transaction<T>(callback: (transaction: DatabaseHostTransaction) => Promise<T>): Promise<T> {
    if (!this.#host.transaction) throw new Error('Database Host does not support transactions');
    return this.#execute(() => this.#host.transaction!(async transaction => {
      let active = true;
      const requireActive = () => { if (!active) throw new Error('Database transaction is already closed'); };
      try {
        return await callback(Object.freeze({ model: (name: string) => {
          requireActive();
          // Reuse the ordinary facade so qualification and generation checks stay identical.
          const model = transaction.model(this.qualify(name));
          const guarded = guardTransactionModel(model, requireActive);
          return this.#bindModel(guarded);
        } }));
      } finally { active = false; }
    }));
  }

  #bindSelection(selection: DatabaseHostSelection): DatabaseHostSelection {
    const modify = (operation: () => DatabaseHostSelection): DatabaseHostSelection => this.#operation.setup(() => {
      const next = operation();
      return next === selection ? chain : this.#bindSelection(next);
    });
    const chain: DatabaseHostSelection = {
      where: (query) => modify(() => selection.where(query)),
      orderBy: (field, direction) => modify(() => selection.orderBy(field, direction)),
      limit: (count) => modify(() => selection.limit(count)),
      then: (fulfilled, rejected) => this.#execute(() => Promise.resolve(selection)).then(fulfilled, rejected),
    };
    return Object.freeze(chain);
  }

  #bindModel(model: DatabaseHostModel): DatabaseHostModel {
    const count = model.count?.bind(model);
    return Object.freeze({
      select: <Fields extends string[]>(...fields: SelectFields<Fields>) =>
        this.#operation.setup(() => this.#bindSelection(model.select<Fields>(...fields))),
      insert: (row) => this.#execute(() => model.insert(row)),
      delete: () => this.#operation.setup(() => Object.freeze({
        where: (query: Record<string, unknown>) => this.#execute(() => model.delete().where(query)),
      })),
      update: (patch) => this.#operation.setup(() => Object.freeze({
        where: (query: Record<string, unknown>) => this.#execute(() => model.update(patch).where(query)),
      })),
      ...(count ? { count: (query?: Record<string, unknown>) => this.#execute(() => count(query)) } : {}),
    } satisfies DatabaseHostModel);
  }

  async #execute<T>(operation: () => Promise<T>): Promise<T> {
    return this.#operation.run(operation);
  }
}

/** A saved query/model cannot escape the callback and reuse the transaction. */
export function guardTransactionModel(model: DatabaseHostModel, check: () => void): DatabaseHostModel {
  const selection = (source: DatabaseHostSelection): DatabaseHostSelection => ({
    where(query) { check(); return selection(source.where(query)); },
    orderBy(field, direction) { check(); return selection(source.orderBy(field, direction)); },
    limit(count) { check(); return selection(source.limit(count)); },
    then(resolve, reject) { return Promise.resolve().then(() => { check(); return source; }).then(resolve, reject); },
  });
  return {
    select: <Fields extends string[]>(...fields: SelectFields<Fields>) => { check(); return selection(model.select<Fields>(...fields)); },
    insert: async row => { check(); return model.insert(row); },
    update: patch => { check(); return { where: async query => { check(); return model.update(patch).where(query); } }; },
    delete: () => { check(); return { where: async query => { check(); return model.delete().where(query); } }; },
  };
}

/**
 * Plugin-facing scoped persistence token. Runtime replaces this binding for
 * every Plugin Scope; plugin code must never receive the process-wide host.
 * The owner encoding keeps `root/a` and `root/a/b` disjoint, so a parent
 * facade cannot accidentally enumerate a descendant's tables.
 */
/** @public Plugin-facing database facade bound to the current owner. */
export const databaseHostToken = createToken<PluginDatabaseHost>(
  'zhin.database.host',
  'Plugin Runtime scoped database host',
);

/** Root-only process host for CLI composition and Console administration. */
export const databaseRootHostToken = createRootPrivateToken<DatabaseHost>(
  'zhin.database.root-host',
  'Plugin Runtime root database host',
);
