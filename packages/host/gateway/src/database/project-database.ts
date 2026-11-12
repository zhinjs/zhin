/**
 * The gateway's own connection to the project database (ADR 0054 §7). It defines and serves only
 * the tables the gateway owns (`console_*`, ADR 0049); the instance opens the same database for
 * everything else. SQLite runs in WAL mode (`@zhin.js/database`), so both processes can hold the
 * file open.
 */
import { isSqliteBusyError, Registry } from '@zhin.js/database';
import type { DatabaseHostModel, DatabaseHostSelection } from '@zhin.js/plugin-runtime';
import type { ProjectDatabaseConfig } from './config.js';

/**
 * How long a gateway statement retries `SQLITE_BUSY` while the instance holds the write lock
 * (`busyRetryMs` in `@zhin.js/database`). The retry backs off asynchronously, so the gateway's
 * event loop keeps serving requests during the wait; a synchronous `busy_timeout` would stall
 * every request for as long as an instance transaction runs. Past the budget the request
 * answers `503 database_busy` ({@link isDatabaseBusyError}).
 */
export const GATEWAY_SQLITE_BUSY_RETRY_MS = 5_000;

/** Seconds a `503 database_busy` asks the client to wait. */
export const DATABASE_BUSY_RETRY_AFTER_SECONDS = 2;

/** The database stayed locked by another connection for the whole retry budget. */
export function isDatabaseBusyError(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    if (isSqliteBusyError(current)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** `503 { code: 'database_busy' }` with `Retry-After`. */
export function databaseBusyResponse(extra: Readonly<Record<string, unknown>> = {}): Response {
  return new Response(JSON.stringify({
    success: false,
    code: 'database_busy',
    error: '数据库正忙，请稍后重试',
    ...extra,
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(DATABASE_BUSY_RETRY_AFTER_SECONDS),
    },
  });
}

interface RawSelection {
  where(query: Record<string, unknown>): unknown;
  orderBy?(field: string, direction?: 'ASC' | 'DESC'): unknown;
  limit?(count: number): unknown;
}

interface RawModel {
  select(...fields: string[]): RawSelection;
  insert(row: Record<string, unknown>): unknown;
  delete(query: Record<string, unknown>): unknown;
  update(patch: Record<string, unknown>): { where(query: Record<string, unknown>): unknown };
}

interface RawDatabase {
  define(name: string, definition: unknown): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly models: Map<string, RawModel>;
}

function wrapModel(model: RawModel): DatabaseHostModel {
  return Object.freeze({
    select: (...fields: string[]) => {
      if (fields.includes('*')) throw new TypeError('select() requires explicit column names');
      const selection = model.select(...fields);
      const chain: DatabaseHostSelection = {
        where: (query) => { selection.where(query); return chain; },
        orderBy: (field, direction) => { selection.orderBy?.(field, direction); return chain; },
        limit: (count) => { selection.limit?.(count); return chain; },
        then: (onfulfilled, onrejected) => Promise.resolve(selection as unknown as PromiseLike<Record<string, unknown>[]>).then(onfulfilled, onrejected),
      };
      return chain;
    },
    insert: (row: Record<string, unknown>) => Promise.resolve(model.insert(row)),
    delete: () => ({ where: (query: Record<string, unknown>) => Promise.resolve(model.delete(query)) }),
    update: (patch: Record<string, unknown>) => ({ where: (query: Record<string, unknown>) => Promise.resolve(model.update(patch).where(query)) }),
  }) as DatabaseHostModel;
}

/** One database connection; tables are defined before {@link start}. */
export class ProjectDatabase {
  readonly config: ProjectDatabaseConfig;
  readonly #db: RawDatabase;
  readonly #tables = new Set<string>();
  readonly #wrapped = new Map<string, DatabaseHostModel>();
  #started = false;

  constructor(config: ProjectDatabaseConfig) {
    this.config = config;
    const { dialect, ...connection } = config;
    // No synchronous busy_timeout: it would block the gateway's event loop (ADR 0054 §7).
    const options = dialect === 'sqlite' && connection.busyRetryMs === undefined
      ? { ...connection, busyRetryMs: GATEWAY_SQLITE_BUSY_RETRY_MS }
      : connection;
    this.#db = Registry.create(dialect as keyof Registry.Config, options as never) as unknown as RawDatabase;
  }

  get dialect(): string {
    return this.config.dialect;
  }

  get started(): boolean {
    return this.#started;
  }

  define(name: string, definition: Record<string, unknown>): void {
    if (this.#started) throw new Error(`Project database already started; cannot define table ${name}`);
    if (this.#tables.has(name)) return;
    this.#tables.add(name);
    this.#db.define(name, definition);
  }

  tables(): readonly string[] {
    return [...this.#tables];
  }

  readonly models = Object.freeze({
    get: (name: string): DatabaseHostModel | undefined => {
      if (!this.#started) return undefined;
      const cached = this.#wrapped.get(name);
      if (cached) return cached;
      const raw = this.#db.models.get(name);
      if (!raw) return undefined;
      const model = wrapModel(raw);
      this.#wrapped.set(name, model);
      return model;
    },
  });

  async start(): Promise<void> {
    if (this.#started) return;
    try {
      await this.#db.start();
    } catch (error) {
      await this.#db.stop().catch(() => undefined);
      throw error;
    }
    this.#started = true;
    this.#wrapped.clear();
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    this.#wrapped.clear();
    await this.#db.stop();
  }
}
