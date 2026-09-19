import {
  definePlugin,
  databaseHostToken,
  outboundHostToken,
  scheduleHostToken,
} from 'zhin.js';
import { resolveRssConfig, type RssConfig } from './src/feed.js';
import {
  createInMemoryRssDb,
  RSS_SEEN_TABLE,
  RSS_SUBS_TABLE,
} from './src/db-store.js';
import { cleanOldSeen, pollAllFeeds } from './src/poll.js';
import { rssRuntimeToken, type RssOutboundPush } from './src/runtime.js';

function defineRssTables(db: { define: (name: string, schema: Record<string, unknown>) => void }): void {
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
  });
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
    const db = context.resources.has(databaseHostToken) ? (() => {
      const host = context.resources.use(databaseHostToken);
      defineRssTables(host);
      return host;
    })() : createInMemoryRssDb();

    let outboundPush: RssOutboundPush | null = null;
    if (context.resources.has(outboundHostToken)) {
      const outbound = context.resources.use(outboundHostToken);
      outboundPush = async (input) => {
        await outbound.send({
          adapter: input.adapterName,
          endpointKey: input.endpointKey,
          conversation: {
            kind: input.channelType as 'private' | 'group' | 'channel',
            id: input.channelId,
          },
          content: input.content,
        });
      };
    }
    const runtime = Object.freeze({
      db,
      config: Object.freeze({ ...config }),
      outbound: outboundPush,
    });
    context.resources.provide(rssRuntimeToken, runtime);

    if (!context.resources.has(scheduleHostToken)) return;
    const schedule = context.resources.use(scheduleHostToken);
    const dispose = schedule.register({
      id: 'rss/poll_feeds',
      cron: config.pollCron,
      description: 'Poll RSS subscriptions',
      async execute() {
        await pollAllFeeds(runtime);
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
