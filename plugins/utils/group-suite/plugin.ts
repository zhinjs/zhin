import { definePlugin, databaseHostToken } from '@zhin.js/plugin-runtime';
import type { GroupSuiteConfig } from './src/config.js';
import { registerGroupSuiteDb } from './src/db-store.js';
import { createInMemoryGroupSuiteDb } from './src/memory-store.js';
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
    const db = context.resources.has(databaseHostToken)
      ? context.resources.use(databaseHostToken)
      : createInMemoryGroupSuiteDb();
    if (context.resources.has(databaseHostToken)) {
      defineGroupSuiteTables(db);
    }
    const runtime = createGroupSuiteRuntime(db);
    context.resources.provide(groupSuiteRuntimeToken, runtime);
    context.lifecycle.add(registerGroupSuiteDb(db));

    const flushTimer = setInterval(() => {
      void flushStatsBuffer(runtime);
    }, 10_000);
    context.lifecycle.add(async () => {
      clearInterval(flushTimer);
      await flushStatsBuffer(runtime);
    });
  },
});
