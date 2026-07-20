import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Registry } from '@zhin.js/database';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  databaseHostToken,
  type DatabaseHost,
  type DatabaseHostModel,
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

function wrapModel(model: RawModel): DatabaseHostModel {
  return {
    select: () => {
      const selection = model.select();
      return {
        where: (query) => Promise.resolve(selection.where(query)) as Promise<Record<string, unknown>[]>,
        then: (onfulfilled, onrejected) =>
          Promise.resolve(selection as PromiseLike<Record<string, unknown>[]>)
            .then(onfulfilled, onrejected),
      };
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
  const db = Registry.create(config.dialect as keyof Registry.Config, config as never) as {
    define: (name: string, definition: unknown) => void;
    start(): Promise<void>;
    stop(): Promise<void>;
    models: Map<string, unknown>;
  };
  let started = false;
  const wrapped = new Map<string, DatabaseHostModel>();
  const definedTables = new Set<string>();

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
