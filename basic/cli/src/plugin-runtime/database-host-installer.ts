import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Registry } from '@zhin.js/database';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  databaseHostToken,
  type DatabaseHost,
  type DatabaseHostConsole,
  type DatabaseHostModel,
  type DatabaseHostSelection,
} from '@zhin.js/plugin-runtime';
import type {
  ConfigDocumentPort,
  RootResourceInstaller,
  RuntimeConfigDocument,
} from '@zhin.js/runtime';

const logger = getLogger('Database');

export type DatabaseHostConfig = {
  readonly dialect: string;
} & Record<string, unknown>;

type RawModel = {
  select: (...fields: string[]) => {
    where(query: Record<string, unknown>): unknown;
    then?: unknown;
  };
  insert: (row: Record<string, unknown>) => unknown;
  delete: (query: Record<string, unknown>) => unknown;
  update: (patch: Record<string, unknown>) => {
    where(query: Record<string, unknown>): unknown;
  };
};

type RawConsoleModel = RawModel & {
  create?: (row: Record<string, unknown>) => unknown;
  updateById?: (id: string, row: Record<string, unknown>) => unknown;
  deleteById?: (id: string) => unknown;
  get?: (key: string) => Promise<unknown>;
  set?: (key: string, value: unknown, ttl?: number) => Promise<void>;
  deleteByKey?: (key: string) => Promise<unknown>;
  entries?: () => Promise<Array<[string, unknown]>>;
};

type RawDatabase = {
  define: (name: string, definition: unknown) => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  models: Map<string, RawConsoleModel>;
  definitions: Map<string, Record<string, unknown>>;
  dialect: { name: string; formatDropTable(name: string, ifExists?: boolean): unknown };
  dialectName: string;
  aggregate(name: string): {
    count(field: string, alias: string): { where(query: Record<string, unknown>): Promise<Array<{ total: number }>> };
  };
  query(query: unknown): Promise<unknown>;
};

function wrapModel(model: RawModel): DatabaseHostModel {
  return {
    select: (...fields) => {
      const selection = (model.select as (...args: string[]) => unknown)(...fields) as {
        where(query: Record<string, unknown>): unknown;
        orderBy?(field: string, direction?: 'ASC' | 'DESC'): unknown;
        limit?(count: number): unknown;
      };
      // 链式 + 可 await：console logs 页需要 orderBy/limit，插件侧 `await select().where(q)` 不变
      const chain: DatabaseHostSelection = {
        where: (query) => { selection.where(query); return chain; },
        orderBy: (field, direction) => { selection.orderBy?.(field, direction); return chain; },
        limit: (count) => { selection.limit?.(count); return chain; },
        then: (onfulfilled, onrejected) =>
          Promise.resolve(selection as unknown as PromiseLike<Record<string, unknown>[]>)
            .then(onfulfilled, onrejected),
      };
      return chain;
    },
    insert: (row) => Promise.resolve(model.insert(row)),
    delete: () => ({
      where: (query) => Promise.resolve(model.delete(query)),
    }),
    update: (patch) => ({
      where: (query) => Promise.resolve(model.update(patch).where(query)),
    }),
  };
}

export function createDatabaseHost(config: DatabaseHostConfig): DatabaseHost & {
  readonly db: { define: (name: string, definition: unknown) => void; start(): Promise<void>; stop(): Promise<void>; models: Map<string, unknown> };
} {
  const db = Registry.create(
    config.dialect as keyof Registry.Config,
    config as never,
  ) as unknown as RawDatabase;
  let started = false;
  const wrapped = new Map<string, DatabaseHostModel>();
  const definedTables = new Set<string>();
  const definitions = new Map<string, Record<string, unknown>>();
  const consolePort = createDatabaseConsole(
    db,
    config.dialect,
    () => started,
    definedTables,
    definitions,
  );

  return {
    db,
    get dialect() {
      return config.dialect;
    },
    get started() {
      return started;
    },
    define(name, definition) {
      if (started) {
        throw new Error(`DatabaseHost already started; cannot define table ${name}`);
      }
      definedTables.add(name);
      definitions.set(name, definition);
      db.define(name, definition);
    },
    tables() {
      return [...definedTables];
    },
    models: {
      get(name) {
        if (!started) return undefined;
        const cached = wrapped.get(name);
        if (cached) return cached;
        const raw = db.models.get(name) as RawModel | undefined;
        if (!raw) return undefined;
        const model = wrapModel(raw);
        wrapped.set(name, model);
        return model;
      },
    },
    console: consolePort,
    getRawDatabase() {
      if (!started) return undefined;
      return db;
    },
    async start() {
      if (started) return;
      await db.start();
      started = true;
      wrapped.clear();
      logger.debug(formatCompact({ op: 'database_start', dialect: config.dialect }));
    },
    async stop() {
      if (!started) return;
      await db.stop();
      started = false;
      wrapped.clear();
    },
  };
}

function createDatabaseConsole(
  db: RawDatabase,
  configuredDialect: string,
  isStarted: () => boolean,
  tableNames: Set<string>,
  definitions: Map<string, Record<string, unknown>>,
): DatabaseHostConsole {
  const type = databaseType(configuredDialect);
  const requireModel = (table: string): RawConsoleModel => {
    if (!isStarted()) throw new Error('Database is not connected');
    const model = db.models.get(table);
    if (!model) throw new Error(`Table '${table}' not found`);
    return model;
  };
  const port: DatabaseHostConsole = {
    info: () => ({
      dialect: configuredDialect,
      type,
      tables: [...tableNames],
      connected: isStarted(),
    }),
    tables: () => [...tableNames].map((name) => ({
      name,
      columns: definitions.get(name),
    })),
    async select(table, page, pageSize, where) {
      const model = requireModel(table);
      if (type === 'keyvalue') {
        if (!model.entries) throw new Error(`Table '${table}' is not a key-value bucket`);
        const all = await model.entries();
        const start = (page - 1) * pageSize;
        return {
          rows: all.slice(start, start + pageSize).map(([key, value]) => ({ key, value })),
          total: all.length,
          page,
          pageSize,
        };
      }
      const filter = where ?? {};
      let total: number;
      try {
        const counted = await db.aggregate(table).count('*', 'total').where(filter);
        total = Number(counted[0]?.total ?? 0);
      } catch {
        const all = await (model.select() as unknown as PromiseLike<unknown[]>);
        total = all.length;
      }
      let selection = model.select() as unknown as {
        where(query: Record<string, unknown>): typeof selection;
        limit(value: number): typeof selection;
        offset(value: number): Promise<unknown[]>;
      };
      if (Object.keys(filter).length > 0) selection = selection.where(filter);
      const rows = await selection.limit(pageSize).offset((page - 1) * pageSize);
      return { rows, total, page, pageSize };
    },
    async insert(table, row) {
      const model = requireModel(table);
      if (type === 'keyvalue') {
        if (!model.set || row.key == null) throw new Error('key is required for KV insert');
        await model.set(String(row.key), row.value);
      } else if (type === 'document' && model.create) {
        await model.create(row);
      } else {
        await model.insert(row);
      }
    },
    async update(table, row, where) {
      const model = requireModel(table);
      if (type === 'keyvalue') {
        if (!model.set || where.key == null) throw new Error('key is required for KV update');
        await model.set(String(where.key), row.value);
        return 1;
      }
      if (type === 'document' && where._id != null && model.updateById) {
        return await model.updateById(String(where._id), row);
      }
      return await model.update(row).where(where);
    },
    async delete(table, where) {
      const model = requireModel(table);
      if (type === 'keyvalue') {
        if (!model.deleteByKey || where.key == null) throw new Error('key is required for KV delete');
        await model.deleteByKey(String(where.key));
        return 1;
      }
      if (type === 'document' && where._id != null && model.deleteById) {
        return await model.deleteById(String(where._id));
      }
      return await model.delete(where);
    },
    async dropTable(table) {
      requireModel(table);
      await db.query(db.dialect.formatDropTable(table, true));
      db.models.delete(table);
      db.definitions.delete(table);
      tableNames.delete(table);
      definitions.delete(table);
    },
    async kvGet(table, key) {
      const model = requireModel(table);
      if (!model.get) throw new Error(`Table '${table}' is not a key-value bucket`);
      return await model.get(key);
    },
    async kvSet(table, key, value, ttl) {
      const model = requireModel(table);
      if (!model.set) throw new Error(`Table '${table}' is not a key-value bucket`);
      await model.set(key, value, ttl);
    },
    async kvDelete(table, key) {
      const model = requireModel(table);
      if (!model.deleteByKey) throw new Error(`Table '${table}' is not a key-value bucket`);
      await model.deleteByKey(key);
    },
    async kvEntries(table) {
      const model = requireModel(table);
      if (!model.entries) throw new Error(`Table '${table}' is not a key-value bucket`);
      return (await model.entries()).map(([key, value]) => ({ key, value }));
    },
  };
  return Object.freeze(port);
}

function databaseType(dialect: string): 'related' | 'document' | 'keyvalue' {
  if (dialect === 'mongodb') return 'document';
  if (dialect === 'redis') return 'keyvalue';
  return 'related';
}

export async function resolveDatabaseConfig(
  projectRoot: string,
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<DatabaseHostConfig> {
  const document = await readConfigDocument(config);
  const configured = document && typeof document === 'object'
    ? (document as Record<string, unknown>).database
    : undefined;
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    const value = configured as Record<string, unknown>;
    const dialect = typeof value.dialect === 'string' ? value.dialect : 'sqlite';
    return Object.freeze({ ...value, dialect }) as DatabaseHostConfig;
  }
  const filename = join(projectRoot, '.zhin', 'data.sqlite');
  await mkdir(dirname(filename), { recursive: true });
  return Object.freeze({ dialect: 'sqlite', filename });
}

export function installDatabaseHost(host: DatabaseHost): RootResourceInstaller {
  return ({ resources, lifecycle, handoff }) => {
    // Domain tables (e.g. github_oauth_users) are defined by owning plugins in setup().
    resources.provide(databaseHostToken, host);
    lifecycle.add(() => host.stop());
    handoff.add({
      activateNext: async () => {
        await host.start();
      },
      deactivateNext: async () => {
        await host.stop();
      },
    });
  };
}

async function readConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!isConfigDocumentPort(config)) return config;
  return (await config.read()).document;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function';
}
