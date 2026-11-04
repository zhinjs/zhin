import { DataMigrationError, pluginDataMigrationProviderToken, TargetMigrationScopes, type PluginStateStore } from 'zhin.js/plugin-runtime';
import { createEarthquakeTargetMigration } from './src/target-migration.js';
import { resolveLocale } from 'zhin.js/i18n';
import {
  databaseHostToken,
  definePlugin,
  logger,
  outboundHostToken,
  scheduleHostToken,
} from 'zhin.js';
import {
  assertEarthquakeTimezone,
  resolveEarthquakeConfig,
  type EarthquakeConfig,
} from './src/config.js';
import { earthquakeServiceToken } from './src/runtime.js';
import { EarthquakeService, type PushSender } from './src/service.js';
import { createMemoryState, SubscriptionStore, subscriptionKey, type KeyValueState } from './src/subscriptions.js';

/**
 * Plugin Runtime:
 * - Commands: `地震` query, `地震 订阅` / `地震 退订` / `地震 订阅状态`.
 * - Agent tool: `recent_earthquakes` (skill `earthquake`).
 * - DB: subscriptions persist in `databaseHostToken.state` when available; else in memory.
 * - Outbound + Schedule: when both hosts exist, a cron job polls and pushes alerts.
 */
export default definePlugin<EarthquakeConfig>({
  name: 'earthquake',
  metadata: {
    displayName: '地震速报',
  },
  setup(context) {
    const config = resolveEarthquakeConfig(context.config.get());
    assertEarthquakeTimezone(config.timezone);

    let state: KeyValueState | undefined;
    let durableState: PluginStateStore | undefined;
    const database = context.resources.has(databaseHostToken) ? context.resources.use(databaseHostToken) : undefined;
    if (database) {
      try {
        durableState = database.state;
        state = durableState;
      } catch {
        // No persistent state port: fall back to memory below.
      }
    }
    const store = new SubscriptionStore(state ?? createMemoryState(), {
      maxSubscriptions: config.maxSubscriptions,
    });

    const migrationScopes = database && durableState ? new TargetMigrationScopes({ pending: scope => !scope.startsWith('canonical:') }) : undefined;
    if (database && durableState && migrationScopes) {
      store.bindMigrationScopes(migrationScopes);
      context.resources.provide(pluginDataMigrationProviderToken, createEarthquakeTargetMigration({ database,
        state: durableState, scopes: migrationScopes }));
    }

    let push: PushSender | undefined;
    if (context.resources.has(outboundHostToken)) {
      const outbound = context.resources.use(outboundHostToken);
      push = async (subscription, content) => {
        const target = subscription.target;
        if (!target) throw new DataMigrationError('unavailable', 'Historical earthquake subscription awaits exact-target binding');
        const send = outbound.sendTarget;
        if (!send) throw new Error('Canonical subscription delivery requires an exact-target Outbound Host');
        const run = async () => { await send(target, content, { locale: resolveLocale(subscription.locale) }); };
        if (migrationScopes) await migrationScopes.run({ scope: subscriptionKey(subscription), run });
        else await run();
      };
    }

    const service = new EarthquakeService({
      config,
      store,
      push,
      logger: { warn: (message) => logger.warn(message) },
    });
    context.resources.provide(earthquakeServiceToken, service);
    context.lifecycle.add(() => service.stop());

    if (!push || !context.resources.has(scheduleHostToken)) return;
    const schedule = context.resources.use(scheduleHostToken);
    const dispose = schedule.register({
      id: 'earthquake/poll',
      cron: config.pollCron,
      description: 'Poll CENC/USGS earthquake feeds and push subscription alerts',
      async execute() {
        // poll() never throws; failures are logged and the next tick tries again.
        await service.poll();
      },
    });
    context.lifecycle.add(dispose);
  },
});
