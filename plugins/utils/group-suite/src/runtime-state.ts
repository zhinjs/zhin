import { createToken } from '@zhin.js/plugin-runtime';
import type { GroupSuiteMemoryDb } from './memory-store.js';

export interface PendingStatsIncrement {
  user_id: string;
  user_name: string;
  group_id: string;
  date: string;
  count: number;
}

/** All mutable state owned by one group-suite plugin instance. */
export interface GroupSuiteRuntime {
  readonly db: GroupSuiteMemoryDb;
  readonly keywords: Map<string, string>;
  readonly teachCooldowns: Map<string, number>;
  readonly statsBuffer: Map<string, PendingStatsIncrement>;
}

export const groupSuiteRuntimeToken = createToken<GroupSuiteRuntime>(
  'zhin.group-suite.runtime',
  'Owner-scoped Group Suite database and ephemeral state',
);

export function createGroupSuiteRuntime(db: GroupSuiteMemoryDb): GroupSuiteRuntime {
  return {
    db,
    keywords: new Map(),
    teachCooldowns: new Map(),
    statsBuffer: new Map(),
  };
}

export function resolveGroupSuiteRuntime(context: {
  owner?: { id?: unknown };
  use<T>(token: typeof groupSuiteRuntimeToken): T;
}): GroupSuiteRuntime | undefined {
  try {
    return context.use(groupSuiteRuntimeToken) as GroupSuiteRuntime;
  } catch (error) {
    if (context.owner?.id) throw error;
    return undefined;
  }
}
