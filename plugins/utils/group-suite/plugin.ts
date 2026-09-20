import { definePlugin, databaseHostToken } from 'zhin.js';
import type { GroupSuiteConfig } from './src/config.js';
import { createInMemoryGroupSuiteDb, type GroupSuiteMemoryDb } from './src/memory-store.js';
import { createGroupSuiteRuntime, groupSuiteRuntimeToken } from './src/runtime-state.js';
import { flushStatsBuffer } from './src/stats-lib.js';
import { defineGroupSuiteTables } from './src/tables.js';

/**
 * Plugin Runtime:
 * - checkin / teach / stats commands + keyword middleware
 * - DB: prefer `databaseHostToken`; else in-memory fallback
 * - Stats buffer: periodic flush every 10s + final flush on dispose
 */
export default definePlugin<GroupSuiteConfig>({
  name: 'group-suite',
  metadata: {
    displayName: 'Group Suite',
  },
  setup(context) {
    // host 与 memory 模型表面结构兼容（where 均返回 PromiseLike），可直接互换。
    const db: GroupSuiteMemoryDb = (() => {
      if (context.resources.has(databaseHostToken)) {
        const host = context.resources.use(databaseHostToken);
        defineGroupSuiteTables(host);
        return host;
      }
      return createInMemoryGroupSuiteDb();
    })();
    const runtime = createGroupSuiteRuntime(db);
    context.resources.provide(groupSuiteRuntimeToken, runtime);

    const flushTimer = setInterval(() => {
      void flushStatsBuffer(runtime);
    }, 10_000);
    context.lifecycle.add(async () => {
      clearInterval(flushTimer);
      await flushStatsBuffer(runtime);
    });
  },
});
