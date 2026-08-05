import { pluginOwnerResourceKey, rootPluginId, type PluginId } from './identity.js';
import { createToken } from './token.js';

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

/**
 * Persistence surface visible to a plugin. Names are logical to the owner;
 * the Runtime maps them to private physical table names before they reach the
 * process-wide DatabaseHost.
 */
export interface PluginDatabaseHost {
  readonly owner: PluginId;
  readonly dialect: string;
  readonly started: boolean;
  define(name: string, definition: Record<string, unknown>): void;
  tables(): readonly string[];
  models: {
    get(name: string): DatabaseHostModel | undefined;
  };
}

const resourcePrefix = '__zhin_plugin__';
const resourceSeparator = '__';
const roots = new WeakMap<PluginDatabaseHost, DatabaseHost>();

/**
 * Maps a plugin's logical resource name to its process-wide physical name.
 * Root keeps its historical bare names so existing projects do not need a
 * database migration merely to adopt scoped child plugins.
 */
export function qualifyPluginResourceName(owner: PluginId, name: string): string {
  assertLogicalResourceName(name);
  if (owner === rootPluginId()) return name;
  return `${resourcePrefix}${pluginOwnerResourceKey(owner)}${resourceSeparator}${name}`;
}

/** Reverse `qualifyPluginResourceName` only when the name belongs to owner. */
export function unqualifyPluginResourceName(owner: PluginId, name: string): string | undefined {
  if (owner === rootPluginId()) return name.startsWith(resourcePrefix) ? undefined : name;
  const prefix = `${resourcePrefix}${pluginOwnerResourceKey(owner)}${resourceSeparator}`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : undefined;
}

/** Creates a tenant facade without exposing Console administration or raw DB access. */
export function createPluginDatabaseHost(
  owner: PluginId,
  host: DatabaseHost,
): PluginDatabaseHost {
  const facade = Object.freeze({
    owner,
    get dialect() { return host.dialect; },
    get started() { return host.started; },
    define(name: string, definition: Record<string, unknown>) {
      host.define(qualifyPluginResourceName(owner, name), definition);
    },
    tables() {
      return Object.freeze(host.tables().flatMap((name) => {
        const logical = unqualifyPluginResourceName(owner, name);
        return logical === undefined ? [] : [logical];
      }));
    },
    models: Object.freeze({
      get(name: string) {
        return host.models.get(qualifyPluginResourceName(owner, name));
      },
    }),
  });
  roots.set(facade, host);
  return facade;
}

/**
 * Recovers a process host from the standard root token or a scoped facade.
 * This keeps custom RootRuntime installers written against the pre-facade
 * token working while child scopes begin receiving tenant boundaries.
 */
export function unwrapPluginDatabaseHost(
  host: DatabaseHost | PluginDatabaseHost,
): DatabaseHost | undefined {
  if ('getRawDatabase' in host) return host;
  return roots.get(host);
}

function assertLogicalResourceName(name: string): void {
  if (!name || name.startsWith(resourcePrefix)) {
    throw new TypeError(`Invalid plugin resource name: ${name}`);
  }
}

/**
 * Plugin-facing scoped persistence token. Runtime replaces this binding for
 * every Plugin Scope; plugin code must never receive the process-wide host.
 * The owner encoding keeps `root/a` and `root/a/b` disjoint, so a parent
 * facade cannot accidentally enumerate a descendant's tables.
 */
export const databaseHostToken = createToken<PluginDatabaseHost>(
  'zhin.database.host',
  'Plugin Runtime scoped database host',
);

/** Root-only process host for CLI composition and Console administration. */
export const databaseRootHostToken = createToken<DatabaseHost>(
  'zhin.database.root-host',
  'Plugin Runtime root database host',
);
