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

export function createInMemoryCredentialDb(): CredentialDb {
  const model = createMemoryModel();
  return {
    models: {
      get: (name) => name === MUSIC_CREDENTIALS_TABLE ? model : undefined,
    },
  };
}

export class CredentialStore {
  constructor(private readonly db: CredentialDb) {}

  private get model(): CredentialModel | null {
    return this.db.models.get(MUSIC_CREDENTIALS_TABLE) ?? null;
  }

  async get(source: MusicSource, key: string): Promise<string | null> {
    const rows = await this.model?.select().where({ source, key });
    if (!rows?.length) return null;
    return String(rows[0]!.value ?? '');
  }

  async set(source: MusicSource, key: string, value: string): Promise<void> {
    const model = this.model;
    if (!model) return;
    const existing = await model.select().where({ source, key });
    if (existing.length > 0) {
      await model.update({ value, updated_at: new Date().toISOString() }).where({ source, key });
      return;
    }
    await model.insert({ source, key, value, updated_at: new Date().toISOString() });
  }

  async delete(source: MusicSource, key: string): Promise<void> {
    await this.model?.delete().where({ source, key });
  }

  async list(source?: MusicSource): Promise<CredentialRow[]> {
    const model = this.model;
    if (!model) return [];
    const rows = source ? await model.select().where({ source }) : await model.select();
    return rows.map((row) => ({
      source: String(row.source) as MusicSource,
      key: String(row.key),
      value: String(row.value),
      updated_at: String(row.updated_at ?? ''),
    }));
  }
}
