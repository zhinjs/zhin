/**
 * Minimal in-memory models for game SessionService (findAll/findOne/create/updateWhere/deleteWhere).
 * In-memory fallback for runtimes without a DatabaseHost.
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
  /** Callback models belong to this atomic unit and cannot be retained after it ends. */
  transaction<T>(operation: (database: InMemoryGameDb) => Promise<T>): Promise<T>;
}

function createMemoryModel(): InMemoryGameModel {
  const rows: Row[] = [];

  const match = (row: Row, q: Record<string, unknown>) =>
    Object.entries(q).every(([k, v]) => row[k] === v);

  return {
    // 返回行拷贝，避免调用方直接改字段绕过 updateWhere
    findAll: async (q: Record<string, unknown> = {}) =>
      rows.filter((row) => match(row, q)).map((row) => ({ ...row })),
    findOne: async (q: Record<string, unknown> = {}) => {
      const found = rows.find((row) => match(row, q));
      return found ? { ...found } : null;
    },
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
        const row = rows[i];
        if (row && match(row, where)) {
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
  const models = new Map(tableNames.map(name => [name, { model: createMemoryModel() }]));
  let tail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const work = tail.then(run, run); tail = work.catch(() => undefined); return work;
  };
  const views = new Map<string, InMemoryGameModel>();
  for (const [name, slot] of models) views.set(name, {
    findAll: query => serialize(() => slot.model.findAll(query)),
    findOne: query => serialize(() => slot.model.findOne(query)),
    create: row => serialize(() => slot.model.create(row)),
    updateWhere: (where, patch) => serialize(() => slot.model.updateWhere(where, patch)),
    deleteWhere: where => serialize(() => slot.model.deleteWhere(where)),
  });
  return {
    models: { get: name => views.get(name) },
    transaction: operation => serialize(async () => {
      const candidate = new Map<string, InMemoryGameModel>();
      const commits: Array<{ slot: { model: InMemoryGameModel }; model: InMemoryGameModel }> = [];
      for (const [name, slot] of models) {
        const copy = createMemoryModel();
        for (const row of await slot.model.findAll()) await copy.create(row);
        candidate.set(name, copy); commits.push({ slot, model: copy });
      }
      let active = true;
      const assertActive = () => { if (!active) throw new Error('Game transaction has ended'); };
      const scoped: InMemoryGameDb = {
        models: { get(name) {
          assertActive(); const model = candidate.get(name); if (!model) return undefined;
          return {
            findAll: query => { assertActive(); return model.findAll(query); },
            findOne: query => { assertActive(); return model.findOne(query); },
            create: row => { assertActive(); return model.create(row); },
            updateWhere: (where, patch) => { assertActive(); return model.updateWhere(where, patch); },
            deleteWhere: where => { assertActive(); return model.deleteWhere(where); },
          };
        } },
        async transaction() { throw new Error('Nested game transactions are not supported'); },
      };
      try {
        const result = await operation(scoped);
        for (const commit of commits) commit.slot.model = commit.model;
        return result;
      } finally { active = false; }
    }),
  };
}

/**
 * Typed boundary used by game tests and standalone embedders. The database
 * implementation is deliberately structural so game packages keep their
 * precise model types without each package recreating the same adapter.
 */
export function createMemoryGameServices<TDatabase, TServices>(
  tableNames: readonly string[],
  factory: (database: TDatabase) => TServices,
): TServices {
  return factory(createInMemoryGameDb(tableNames) as unknown as TDatabase);
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
  transaction?<T>(operation: (transaction: { model(name: string): HostGameModelSource }) => Promise<T>): Promise<T>;
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
        return createDeferredHostModel(host, name);
      },
    },
    async transaction(operation) {
      if (!host.transaction) throw new Error('The configured game Database Host does not support atomic transactions');
      return host.transaction(transaction => operation(createHostGameDb({ models: { get: name => transaction.model(name) } }, tableNames)));
    },
  };
}

function createDeferredHostModel(
  host: HostGameDbSource,
  name: string,
): InMemoryGameModel {
  let cached: InMemoryGameModel | undefined;
  const resolve = (): InMemoryGameModel => {
    if (cached) return cached;
    const raw = host.models.get(name);
    if (!raw) throw new Error(`DatabaseHost model '${name}' not available (database may not have started)`);
    cached = wrapHostModel(raw);
    return cached;
  };
  return {
    findAll: (q) => resolve().findAll(q),
    findOne: (q) => resolve().findOne(q),
    create: (row) => resolve().create(row),
    updateWhere: (where, patch) => resolve().updateWhere(where, patch),
    deleteWhere: (where) => resolve().deleteWhere(where),
  };
}
