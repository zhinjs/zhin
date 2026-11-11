/**
 * The gateway's own connection to the project database (ADR 0054 §7). It defines and serves only
 * the tables the gateway owns (`console_*`, ADR 0049); the instance opens the same database for
 * everything else. SQLite runs in WAL mode with a busy timeout (`@zhin.js/database`), so both
 * processes can hold the file open.
 */
import { Registry } from '@zhin.js/database';
import type { DatabaseHostModel, DatabaseHostSelection } from '@zhin.js/plugin-runtime';
import type { ProjectDatabaseConfig } from './config.js';

/**
 * How long the gateway's SQLite connection waits for the instance's write lock. The gateway's
 * writes are single statements, so a wait never deadlocks it; the instance keeps fail-fast + retry.
 */
export const GATEWAY_SQLITE_BUSY_TIMEOUT_MS = 2_000;

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
    const options = dialect === 'sqlite' && connection.busyTimeoutMs === undefined
      ? { ...connection, busyTimeoutMs: GATEWAY_SQLITE_BUSY_TIMEOUT_MS }
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
