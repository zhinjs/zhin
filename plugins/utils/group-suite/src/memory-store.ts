/**
 * In-memory group-suite models (slice-2) until Plugin Runtime DatabaseFeature Resource lands.
 *
 * 模型表面与 `@zhin.js/plugin-runtime` 的 DatabaseHostModel 结构兼容
 * （where 返回 PromiseLike，host 侧是链式 Selection），
 * plugin.ts 可把 PluginDatabaseHost 直接当 GroupSuiteMemoryDb 用。
 */

export type GroupSuiteRow = Record<string, unknown>;

export interface GroupSuiteModel {
  select: (...fields: string[]) => {
    where: (query: Record<string, unknown>) => PromiseLike<GroupSuiteRow[]>;
    then: <TResult1 = GroupSuiteRow[], TResult2 = never>(
      onfulfilled?: ((value: GroupSuiteRow[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise<TResult1 | TResult2>;
  };
  insert: (row: Record<string, unknown>) => Promise<unknown>;
  delete: () => { where: (query: Record<string, unknown>) => Promise<unknown> };
  update: (patch: Record<string, unknown>) => {
    where: (query: Record<string, unknown>) => Promise<unknown>;
  };
}

function createMemoryModel(): GroupSuiteModel {
  const rows: GroupSuiteRow[] = [];
  let nextId = 1;

  function matches(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
    return Object.entries(query).every(([key, value]) => row[key] === value);
  }

  function all(): GroupSuiteRow[] {
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
      const withId: GroupSuiteRow = { id: String(nextId++), ...row };
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

export interface GroupSuiteMemoryDb {
  models: {
    get: (name: string) => GroupSuiteModel | undefined;
  };
}

export const CHECKIN_TABLE = 'checkin_records';
export const TEACH_TABLE = 'teach_qa';
export const STATS_TABLE = 'message_stats';

export function createInMemoryGroupSuiteDb(): GroupSuiteMemoryDb {
  const models = new Map<string, GroupSuiteModel>([
    [CHECKIN_TABLE, createMemoryModel()],
    [TEACH_TABLE, createMemoryModel()],
    [STATS_TABLE, createMemoryModel()],
  ]);
  return {
    models: {
      get: (name: string) => models.get(name),
    },
  };
}
