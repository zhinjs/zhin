import { createToken } from './token.js';

/**
 * Minimal model surface shared by lottery / rss / group-suite memory stores
 * and the Host-backed `@zhin.js/database` adapter.
 */
export interface DatabaseHostModel {
  select(): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    then<TResult1 = Record<string, unknown>[], TResult2 = never>(
      onfulfilled?: ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2>;
  };
  insert(row: Record<string, unknown>): Promise<unknown>;
  delete(): { where(query: Record<string, unknown>): Promise<unknown> };
  update(patch: Record<string, unknown>): {
    where(query: Record<string, unknown>): Promise<unknown>;
  };
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
  readonly dialect: string;
  readonly started: boolean;
  /** Register a table schema before `start` (column defs match `@zhin.js/database`). */
  define(name: string, definition: Record<string, unknown>): void;
  /** Names of tables registered via `define` (Console `db:tables`). */
  tables(): readonly string[];
  models: {
    get(name: string): DatabaseHostModel | undefined;
  };
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

export const databaseHostToken = createToken<DatabaseHost>(
  'zhin.database.host',
  'Plugin Runtime database host',
);
