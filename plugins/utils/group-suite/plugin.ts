import { definePlugin, databaseHostToken } from 'zhin.js';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from './src/config.js';
import { createInMemoryGroupSuiteDb, type GroupSuiteMemoryDb } from './src/memory-store.js';
import { createGroupSuiteRuntime, groupSuiteRuntimeToken } from './src/runtime-state.js';
import { defineGroupSuiteTables } from './src/tables.js';

/**
 * Plugin Runtime:
 * - checkin / teach / stats commands + keyword middleware
 * - DB: prefer `databaseHostToken`; else in-memory fallback
 * - Stats writes run inside admitted schedule/query operations
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
    const config = resolveGroupSuiteConfig(context.config.get());
    if (config.keywordReply && !config.ephemeralKeywords) {
      // Fail before activation rather than claiming durable keywords in a memory fallback.
      if (!context.resources.has(databaseHostToken)) throw new Error('Persistent keywords require a Database Host; demos may explicitly set ephemeralKeywords: true');
      void context.resources.use(databaseHostToken).state;
    }
    const runtime = createGroupSuiteRuntime(db);
    context.resources.provide(groupSuiteRuntimeToken, runtime);
  },
});
