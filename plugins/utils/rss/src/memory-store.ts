/**
 * In-memory RSS models (slice-2) until Plugin Runtime DatabaseFeature Resource lands.
 *
 * 模型表面与 `@zhin.js/plugin-runtime` 的 DatabaseHostModel 结构兼容：
 * select 的 where 返回 PromiseLike（host 返回链式 Selection，memory 返回 Promise），
 * 这样 plugin.ts 可以把 PluginDatabaseHost 直接当 RssMemoryDb 用。
 */

export type RssRow = Record<string, unknown>;

export interface RssModel {
  select: (...fields: string[]) => {
    where: (query: Record<string, unknown>) => PromiseLike<RssRow[]>;
    then: <TResult1 = RssRow[], TResult2 = never>(
      onfulfilled?: ((value: RssRow[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise<TResult1 | TResult2>;
  };
  insert: (row: Record<string, unknown>) => Promise<unknown>;
  delete: () => { where: (query: Record<string, unknown>) => Promise<unknown> };
  update: (patch: Record<string, unknown>) => {
    where: (query: Record<string, unknown>) => Promise<unknown>;
  };
}

function createMemoryModel(): RssModel {
  const rows: RssRow[] = [];
  let nextId = 1;

  function matches(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
    return Object.entries(query).every(([key, value]) => row[key] === value);
  }

  function all(): RssRow[] {
    return rows.map((row) => ({ ...row }));
  }

  return {
    select: () => {
      const promise = Promise.resolve(all());
      return {
        where: async (query: Record<string, unknown>) =>
          rows.filter((row) => matches(row, query)).map((row) => ({ ...row })),
        then: (onfulfilled, onrejected) => promise.then(onfulfilled, onrejected),
      };
    },
    insert: async (row: Record<string, unknown>) => {
      const withId: RssRow = { id: String(nextId++), ...row };
      rows.push(withId);
      return { ...withId };
    },
    delete: () => ({
      where: async (query: Record<string, unknown>) => {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (matches(rows[i]!, query)) rows.splice(i, 1);
        }
      },
    }),
    update: (patch: Record<string, unknown>) => ({
      where: async (query: Record<string, unknown>) => {
        for (const row of rows) {
          if (matches(row, query)) Object.assign(row, patch);
        }
      },
    }),
  };
}

export interface RssMemoryDb {
  models: {
    get: (name: string) => RssModel | undefined;
  };
}

export const RSS_SUBS_TABLE = 'rss_subscriptions';
export const RSS_SEEN_TABLE = 'rss_seen_items';

export function createInMemoryRssDb(): RssMemoryDb {
  const models = new Map<string, RssModel>([
    [RSS_SUBS_TABLE, createMemoryModel()],
    [RSS_SEEN_TABLE, createMemoryModel()],
  ]);
  return {
    models: {
      get: (name: string) => models.get(name),
    },
  };
}
