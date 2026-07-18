import { definePlugin, databaseHostToken } from '@zhin.js/plugin-runtime';
import type { GroupSuiteConfig } from './src/config.js';
import { ensureGroupSuiteMemoryDb, setGroupSuiteDb } from './src/db-store.js';
import { flushStatsBuffer } from './src/stats-lib.js';
import { defineGroupSuiteTables } from './src/tables.js';

/**
 * Plugin Runtime:
 * - checkin / teach / stats commands + keyword middleware
 * - DB: prefer `databaseHostToken`; else in-memory fallback
 * - Stats buffer: periodic flush every 10s + final flush on dispose
 *
 * TODO: notice welcome/recall, daily-analysis, HTML stats cards.
 */
export default definePlugin<GroupSuiteConfig>({
  name: 'group-suite',
  metadata: {
    displayName: 'Group Suite',
  },
  setup(context) {
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      defineGroupSuiteTables(host);
      setGroupSuiteDb(host);
    } else {
      ensureGroupSuiteMemoryDb();
    }

    const flushTimer = setInterval(() => {
      void flushStatsBuffer();
    }, 10_000);
    context.lifecycle.add(async () => {
      clearInterval(flushTimer);
      await flushStatsBuffer();
    });
  },
});
