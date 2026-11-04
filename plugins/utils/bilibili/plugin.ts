import { DataMigrationError, pluginDataMigrationProviderToken, TargetMigrationScopes } from 'zhin.js/plugin-runtime';
import { createSubscriptionTargetMigration, subscriptionMigrationScope } from './src/target-migration.js';
import {
  definePlugin,
  databaseHostToken,
  outboundHostToken,
  scheduleHostToken,
} from 'zhin.js';
import { BiliClient } from './src/api.js';
import { resolveBilibiliConfig, type BilibiliConfig } from './src/config.js';
import { BilibiliWatcher } from './src/poll.js';
import { bilibiliRuntimeToken, type BiliOutboundPush } from './src/runtime.js';
import { createInMemoryBiliDb, defineBiliTables, type BiliDb } from './src/store.js';

/**
 * Plugin Runtime:
 * - Commands: `bili sub|unsub|list|live`.
 * - DB: `databaseHostToken` when configured, otherwise in-memory.
 * - Outbound: `outboundHostToken` pushes live starts / new dynamics.
 * - Schedule: `scheduleHostToken` drives the conservative watcher.
 */
export default definePlugin<BilibiliConfig>({
  name: 'bilibili',
  metadata: {
    displayName: '哔哩哔哩订阅',
  },
  setup(context) {
    const config = Object.freeze(resolveBilibiliConfig(context.config.get()));
    const database = context.resources.has(databaseHostToken) ? context.resources.use(databaseHostToken) : undefined;
    let db: BiliDb;
    if (database) {
      defineBiliTables(database);
      db = database as unknown as BiliDb;
    } else {
      db = createInMemoryBiliDb();
    }

    const migrationScopes = database ? new TargetMigrationScopes({ pending: scope => scope.startsWith('historical:') }) : undefined;
    if (database && migrationScopes) context.resources.provide(pluginDataMigrationProviderToken,
      createSubscriptionTargetMigration({ database, scopes: migrationScopes }));

    const outbound = context.resources.has(outboundHostToken) ? context.resources.use(outboundHostToken) : undefined;
    const push: BiliOutboundPush | null = outbound
      ? async (input) => {
        if (!input.target) throw new DataMigrationError('unavailable', 'Historical Bilibili subscription awaits exact-target binding');
        if (!outbound.sendTarget) throw new Error('Canonical subscription delivery requires an exact-target Outbound Host');
        const run = async () => { await outbound.sendTarget!(input.target!, input.content, { locale: input.locale }); };
        if (migrationScopes) await migrationScopes.run({ scope: subscriptionMigrationScope(input), run });
        else await run();
      }
      : null;

    const client = new BiliClient({ timeout: config.timeout, cookie: config.cookie });
    const watcher = new BilibiliWatcher({ db, config, client, outbound: push, signal: context.signal });
    context.resources.provide(bilibiliRuntimeToken, Object.freeze({
      db,
      migrationScopes,
      config,
      client,
      outbound: push,
      watcher,
      persistent: database !== undefined,
    }));

    if (!context.resources.has(scheduleHostToken) || (!config.live && !config.dynamic)) return;
    const dispose = context.resources.use(scheduleHostToken).register({
      id: 'bilibili/watch',
      cron: config.pollCron,
      description: 'Poll Bilibili live status and UP dynamics',
      async execute() {
        // The watcher records and backs off on its own; never fail the job.
        await watcher.tick();
      },
    });
    context.lifecycle.add(dispose);
  },
});
