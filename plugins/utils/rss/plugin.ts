import {
  definePlugin,
  databaseHostToken,
  outboundHostToken,
  scheduleHostToken,
} from '@zhin.js/plugin-runtime';
import { fetchFeed, resolveRssConfig, type RssConfig } from './src/feed.js';
import {
  ensureRssMemoryDb,
  getRssSubs,
  setRssDb,
  RSS_SEEN_TABLE,
  RSS_SUBS_TABLE,
} from './src/db-store.js';
import { setRssAgentDeps } from './src/rss-agent-deps.js';
import { cleanOldSeen, pollAllFeeds, setRssOutboundPush } from './src/poll.js';

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
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      defineRssTables(host);
      setRssDb(host);
    } else {
      ensureRssMemoryDb();
    }

    if (context.resources.has(outboundHostToken)) {
      const outbound = context.resources.use(outboundHostToken);
      setRssOutboundPush(async (input) => {
        await outbound.send({
          adapter: input.adapterName,
          endpointId: input.endpointId,
          channelType: input.channelType,
          channelId: input.channelId,
          content: input.content,
        });
      });
      context.lifecycle.add(() => setRssOutboundPush(null));
    }

    setRssAgentDeps({
      getSubs: () => getRssSubs() as { select: () => Promise<unknown[]> } | null,
      fetchFeed: (url) => fetchFeed(url, config.timeout).then((f) => ({
        title: f.title,
        items: f.items.map((i) => ({ title: i.title, link: i.link })),
      })),
    });

    if (!context.resources.has(scheduleHostToken)) return;
    const schedule = context.resources.use(scheduleHostToken);
    const dispose = schedule.register({
      id: 'rss/poll_feeds',
      cron: config.pollCron,
      description: 'Poll RSS subscriptions',
      async execute() {
        await pollAllFeeds(config);
      },
    });
    const disposeClean = schedule.register({
      id: 'rss/clean_old_seen',
      cron: '0 0 4 * * *',
      description: 'Clean seen records older than 7 days',
      async execute() {
        await cleanOldSeen();
      },
    });
    context.lifecycle.add(dispose);
    context.lifecycle.add(disposeClean);
  },
});
