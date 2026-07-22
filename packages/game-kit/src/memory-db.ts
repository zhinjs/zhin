/**
 * Minimal in-memory models for game SessionService (findAll/findOne/create/updateWhere/deleteWhere).
 * Slice-2 fallback while Plugin Runtime has no DatabaseFeature Resource path.
 */

type Row = Record<string, unknown>;

export interface InMemoryGameModel {
  findAll: (q?: Record<string, unknown>) => Promise<Row[]>;
  findOne: (q?: Record<string, unknown>) => Promise<Row | null>;
  create: (row: Row) => Promise<Row>;
  updateWhere: (where: Record<string, unknown>, patch: Row) => Promise<number>;
  deleteWhere: (where: Record<string, unknown>) => Promise<number>;
}

export interface InMemoryGameDb {
  models: { get: (name: string) => InMemoryGameModel | undefined };
}

function createMemoryModel(): InMemoryGameModel {
  const rows: Row[] = [];

  const match = (row: Row, q: Record<string, unknown>) =>
    Object.entries(q).every(([k, v]) => row[k] === v);

  return {
    findAll: async (q: Record<string, unknown> = {}) => rows.filter((row) => match(row, q)),
    findOne: async (q: Record<string, unknown> = {}) => rows.find((row) => match(row, q)) ?? null,
    create: async (row: Row) => {
      rows.push({ ...row });
      return row;
    },
    updateWhere: async (where: Record<string, unknown>, patch: Row) => {
      let n = 0;
      for (const row of rows) {
        if (match(row, where)) {
          Object.assign(row, patch);
          n += 1;
        }
      }
      return n;
    },
    deleteWhere: async (where: Record<string, unknown>) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (match(rows[i]!, where)) {
          rows.splice(i, 1);
          n += 1;
        }
      }
      return n;
    },
  };
}

/** Create an in-memory db with the given model table names. */
export function createInMemoryGameDb(tableNames: readonly string[]): InMemoryGameDb {
  const models = new Map<string, InMemoryGameModel>();
  for (const name of tableNames) {
    models.set(name, createMemoryModel());
  }
  return {
    models: {
      get: (name: string) => models.get(name),
    },
  };
}

/** Minimal DatabaseHost model surface (structural typing; no plugin-runtime dep). */
export interface HostGameModelSource {
  select(): {
    // DatabaseHostSelection is a thenable, not an instance of Promise; accept both.
    where(query: Record<string, unknown>): PromiseLike<Record<string, unknown>[]>;
  };
  insert(row: Record<string, unknown>): Promise<unknown>;
  delete(): { where(query: Record<string, unknown>): Promise<unknown> };
  update(patch: Record<string, unknown>): {
    where(query: Record<string, unknown>): Promise<unknown>;
  };
}

export interface HostGameDbSource {
  models: { get(name: string): HostGameModelSource | undefined };
}

function wrapHostModel(model: HostGameModelSource): InMemoryGameModel {
  return {
    findAll: async (q: Record<string, unknown> = {}) => {
      const rows = await model.select().where(q);
      return rows as Row[];
    },
    findOne: async (q: Record<string, unknown> = {}) => {
      const rows = await model.select().where(q);
      return (rows[0] as Row | undefined) ?? null;
    },
    create: async (row: Row) => {
      await model.insert(row);
      return row;
    },
    updateWhere: async (where: Record<string, unknown>, patch: Row) => {
      const matching = await model.select().where(where);
      if (matching.length === 0) return 0;
      await model.update(patch).where(where);
      return matching.length;
    },
    deleteWhere: async (where: Record<string, unknown>) => {
      const matching = await model.select().where(where);
      if (matching.length === 0) return 0;
      await model.delete().where(where);
      return matching.length;
    },
  };
}

/** Adapt DatabaseHost models to SessionService RelatedModel-style API. */
export function createHostGameDb(
  host: HostGameDbSource,
  tableNames: readonly string[],
): InMemoryGameDb {
  return {
    models: {
      get: (name: string) => {
        if (!tableNames.includes(name)) return undefined;
        const raw = host.models.get(name);
        return raw ? wrapHostModel(raw) : undefined;
      },
    },
  };
}
