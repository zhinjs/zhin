/**
 * In-memory group-suite models (slice-2) until Plugin Runtime DatabaseFeature Resource lands.
 */

export interface GroupSuiteRow extends Record<string, unknown> {
  id: string;
}

export interface GroupSuiteModel {
  select: () => {
    where: (query: Record<string, unknown>) => Promise<GroupSuiteRow[]>;
    then: <TResult1 = GroupSuiteRow[], TResult2 = never>(
      onfulfilled?: ((value: GroupSuiteRow[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise<TResult1 | TResult2>;
  };
  insert: (row: Record<string, unknown>) => Promise<GroupSuiteRow>;
  delete: () => { where: (query: Record<string, unknown>) => Promise<void> };
  update: (patch: Record<string, unknown>) => {
    where: (query: Record<string, unknown>) => Promise<void>;
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
