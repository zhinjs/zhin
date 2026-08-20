import {
  createGenerationStore,
  type Dispose,
  type GenerationStoreContext,
} from 'zhin.js/plugin-runtime';
import type { MusicSource } from './types.js';

export const MUSIC_CREDENTIALS_TABLE = 'music_credentials';

export interface CredentialRow {
  source: MusicSource;
  key: string;
  value: string;
  updated_at: string;
}

export interface CredentialModel {
  select(...fields: string[]): {
    where(query: Record<string, unknown>): PromiseLike<Record<string, unknown>[]>;
    then<TResult1 = Record<string, unknown>[], TResult2 = never>(
      onfulfilled?:
        | ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2>;
  };
  insert(row: Record<string, unknown>): Promise<unknown>;
  delete(): { where(query: Record<string, unknown>): Promise<unknown> };
  update(patch: Record<string, unknown>): {
    where(query: Record<string, unknown>): Promise<unknown>;
  };
}

export interface CredentialDb {
  models: { get(name: string): CredentialModel | undefined };
}

function createMemoryModel(): CredentialModel {
  const rows: Record<string, unknown>[] = [];

  function matches(
    row: Record<string, unknown>,
    query: Record<string, unknown>,
  ): boolean {
    return Object.entries(query).every(([k, v]) => row[k] === v);
  }

  return {
    select: () => {
      const all = rows.map((r) => ({ ...r }));
      return {
        where: async (query) =>
          rows.filter((r) => matches(r, query)).map((r) => ({ ...r })),
        then: (onfulfilled, onrejected) =>
          Promise.resolve(all).then(onfulfilled, onrejected),
      };
    },
    insert: async (row) => {
      rows.push({ ...row });
    },
    delete: () => ({
      where: async (query) => {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (matches(rows[i]!, query)) rows.splice(i, 1);
        }
      },
    }),
    update: (patch) => ({
      where: async (query) => {
        for (const row of rows) {
          if (matches(row, query)) Object.assign(row, patch);
        }
      },
    }),
  };
}

const credentialDbStore = createGenerationStore<CredentialDb>('music/credential-db');
let _memoryDb: CredentialDb | null = null;

export function provideCredentialDb(
  context: GenerationStoreContext,
  db: CredentialDb,
): Dispose {
  return credentialDbStore.provide(context, db);
}

function getDb(): CredentialDb {
  const provided = credentialDbStore.tryUse();
  if (provided) return provided;
  if (!_memoryDb) {
    _memoryDb = {
      models: {
        get: (name) =>
          name === MUSIC_CREDENTIALS_TABLE ? memoryModel : undefined,
      },
    };
  }
  return _memoryDb;
}

const memoryModel = createMemoryModel();

function getModel(): CredentialModel | null {
  return getDb().models.get(MUSIC_CREDENTIALS_TABLE) ?? null;
}

export async function getCredential(
  source: MusicSource,
  key: string,
): Promise<string | null> {
  const model = getModel();
  if (!model) return null;
  const rows = await model.select().where({ source, key });
  if (rows.length === 0) return null;
  return String(rows[0]!.value ?? '');
}

export async function setCredential(
  source: MusicSource,
  key: string,
  value: string,
): Promise<void> {
  const model = getModel();
  if (!model) return;
  const existing = await model.select().where({ source, key });
  if (existing.length > 0) {
    await model
      .update({ value, updated_at: new Date().toISOString() })
      .where({ source, key });
  } else {
    await model.insert({
      source,
      key,
      value,
      updated_at: new Date().toISOString(),
    });
  }
}

export async function deleteCredential(
  source: MusicSource,
  key: string,
): Promise<void> {
  const model = getModel();
  if (!model) return;
  await model.delete().where({ source, key });
}

export async function listCredentials(
  source?: MusicSource,
): Promise<CredentialRow[]> {
  const model = getModel();
  if (!model) return [];
  const rows = source
    ? await model.select().where({ source })
    : await model.select();
  return rows.map((r) => ({
    source: String(r.source) as MusicSource,
    key: String(r.key),
    value: String(r.value),
    updated_at: String(r.updated_at ?? ''),
  }));
}

export function resetCredentialDb(): void {
  credentialDbStore.clear();
  _memoryDb = null;
}
