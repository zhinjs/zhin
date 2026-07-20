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
