import { projectLocaleToken, resolveLocale } from 'zhin.js/i18n';
import {
  definePlugin,
  logger,
  databaseHostToken,
  outboundHostToken,
  scheduleHostToken,
} from 'zhin.js';
import { pluginTaskProviderToken } from 'zhin.js/plugin-runtime';
import { createAdministratorRssState } from './src/storage.js';
import { AdministratorRssTasks } from './src/admin-tasks.js';
import { resolveRssConfig, type RssConfig } from './src/feed.js';
import {
  createInMemoryRssDb,
  RSS_SEEN_TABLE,
  RSS_SUBS_TABLE,
} from './src/db-store.js';
import { cleanOldSeen, pollAllFeeds } from './src/poll.js';
import { rssRuntimeToken, type RssOutboundPush } from './src/runtime.js';

function defineRssTables(db: { define: (name: string, schema: Record<string, unknown>, options?: { addColumns: readonly string[] }) => void }): void {
  db.define(RSS_SUBS_TABLE, {
    url: { type: 'text', nullable: false },
    feed_title: { type: 'text', default: '' },
    adapter_name: { type: 'text', nullable: false },
    endpoint_id: { type: 'text', default: '' },
    channel_type: { type: 'text', default: 'private' },
    channel_id: { type: 'text', nullable: false },
    creator_id: { type: 'text', default: '' },
    creator_name: { type: 'text', default: '' },
    created_at: { type: 'text', default: '' },
    locale: { type: 'text', length: 16, default: 'zh-CN' },
  }, { addColumns: ['locale'] });
  db.define(RSS_SEEN_TABLE, {
    feed_url: { type: 'text', nullable: false },
    item_guid: { type: 'text', nullable: false },
    item_title: { type: 'text', default: '' },
    seen_at: { type: 'text', default: '' },
  });
}

/**
 * Plugin Runtime:
 * - Commands: add/list/remove/check.
 * - DB: prefer `databaseHostToken`; else in-memory.
 * - Outbound: `outboundHostToken` pushes new items to subscriber channels.
 * - Cron: `scheduleHostToken` poll job when available.
 */
export default definePlugin<RssConfig>({
  name: 'rss',
  metadata: {
    displayName: 'RSS',
  },
  setup(context) {
    const config = resolveRssConfig(context.config.get());
    const database = context.resources.has(databaseHostToken) ? context.resources.use(databaseHostToken) : undefined;
    const db = database ? (() => {
      const host = database;
      defineRssTables(host);
      return host;
    })() : createInMemoryRssDb();

    const outbound = context.resources.has(outboundHostToken) ? context.resources.use(outboundHostToken) : undefined;
    let outboundPush: RssOutboundPush | null = null;
    if (outbound) {
      outboundPush = async (input) => {
        await outbound.send({
          adapter: input.adapterName,
          endpointKey: input.endpointKey,
          conversation: {
            kind: input.channelType,
            id: input.channelId,
          },
          content: input.content,
        });
      };
    }
    const runtime = Object.freeze({
      db,
      locale: resolveLocale(context.resources.use(projectLocaleToken)),
      config: Object.freeze({ ...config }),
      outbound: outboundPush,
    });
    context.resources.provide(rssRuntimeToken, runtime);

    // Keep optional in-memory/chat-only installations working. Administrator tasks
    // must have the real durable state port, exact outbound and an active scheduler.
    let administrator: AdministratorRssTasks | undefined;
    const structuredTasks = database && ['sqlite', 'mysql', 'pg'].includes(database.dialect);
    if (database && !structuredTasks) logger.warn('RSS 管理员任务持久化仅支持 SQLite、MySQL、PostgreSQL；聊天订阅保留现有存储方式');
    if (structuredTasks && database && outbound?.sendTarget && context.resources.has(scheduleHostToken)) {
      let state;
      try { state = database.state; } catch { /* No persistent state port: no administrator provider. */ }
      if (state) {
        administrator = new AdministratorRssTasks(createAdministratorRssState(database), outbound, config, undefined, runtime.locale);
        context.resources.provide(pluginTaskProviderToken, administrator);
        context.lifecycle.add(() => administrator?.stop());
      }
    }

    if (!context.resources.has(scheduleHostToken)) return;
    const schedule = context.resources.use(scheduleHostToken);
    const dispose = schedule.register({
      id: 'rss/poll_feeds',
      cron: config.pollCron,
      description: 'Poll RSS subscriptions',
      async execute() {
        // Both pools share this existing registration. A slow chat feed does not
        // prevent administrator polling, and neither pool shares the other's cursor.
        const results = await Promise.allSettled([pollAllFeeds(runtime), administrator?.tick()]);
        // Keep the schedule lease until both pools drain, even if one fails.
        for (const result of results) if (result.status === 'rejected') throw result.reason;
      },
    });
    const disposeClean = schedule.register({
      id: 'rss/clean_old_seen',
      cron: '0 0 4 * * *',
      description: 'Clean seen records older than 7 days',
      async execute() {
        await cleanOldSeen(runtime);
      },
    });
    context.lifecycle.add(dispose);
    context.lifecycle.add(disposeClean);
  },
});
