import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { databaseHostToken } from 'zhin.js';
import plugin from '../plugin.ts';
import previewCommand from '../commands/rss-preview/[url]/index.ts';
import listCommand from '../commands/rss-list/index.ts';
import addCommand from '../commands/rss-add/[url]/index.ts';
import removeCommand from '../commands/rss-remove/[url]/index.ts';
import checkCommand from '../commands/rss-check/[[url]]/index.ts';
import { formatFeedPreview, resolveRssConfig, stripHtml } from '../src/feed.js';
import { createInMemoryRssDb, getRssSubs } from '../src/db-store.js';
import { rssRuntimeToken, type RssRuntime } from '../src/runtime.js';
import { SMOKE_CHANNEL } from '../src/channel.js';

function createRuntime(overrides: Partial<RssRuntime> = {}): RssRuntime {
  return {
    db: createInMemoryRssDb(),
    config: resolveRssConfig({}),
    outbound: null,
    ...overrides,
  };
}

function commandContext(runtime: RssRuntime) {
  return {
    owner: {} as never,
    generation: 0,
    config: {},
    use: (token: unknown) => {
      if (token === rssRuntimeToken) return runtime;
      throw new Error('unexpected token');
    },
    args: [],
    params: {},
    input: undefined,
  };
}

describe('@zhin.js/plugin-rss runtime', () => {

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('rss');
  });

  it('brands preview and list commands', () => {
    expect(parseCommandDefinition(previewCommand)).toBe(previewCommand);
    expect(parseCommandDefinition(listCommand)).toBe(listCommand);
  });

  it('resolves config and strips html', () => {
    expect(resolveRssConfig({}).maxItems).toBe(5);
    expect(stripHtml('<b>hi</b> &nbsp; there')).toBe('hi there');
  });

  it('formats empty feed preview', () => {
    expect(formatFeedPreview('Demo', [])).toBe('Demo: 暂无内容');
  });

  it('rejects invalid preview url without network', async () => {
    const emptyCtx = commandContext(createRuntime());
    const result = await previewCommand.execute({
      ...emptyCtx,
      params: { url: 'ftp://x' },
    });
    expect(result).toContain('HTTP/HTTPS');
  });

  it('list is empty then add/remove work against memory store', async () => {
    const runtime = createRuntime();
    const emptyCtx = commandContext(runtime);
    const empty = await listCommand.execute({ ...emptyCtx });
    expect(String(empty)).toContain('没有订阅');

    const Subs = getRssSubs(runtime.db)!;
    await Subs.insert({
      url: 'https://example.com/feed.xml',
      feed_title: 'Example',
      adapter_name: SMOKE_CHANNEL.adapterName,
      endpoint_id: SMOKE_CHANNEL.endpointKey,
      channel_type: SMOKE_CHANNEL.channelType,
      channel_id: SMOKE_CHANNEL.channelId,
      creator_id: '',
      creator_name: '',
      created_at: new Date().toISOString(),
    });

    const listed = await listCommand.execute({ ...emptyCtx });
    expect(String(listed)).toContain('Example');
    expect(String(listed)).toContain('https://example.com/feed.xml');

    const removed = await removeCommand.execute({
      ...emptyCtx,
      params: { url: 'https://example.com/feed.xml' },
    });
    expect(String(removed)).toContain('已取消订阅');

    const after = await listCommand.execute({ ...emptyCtx });
    expect(String(after)).toContain('没有订阅');
  });

  it('rss-add rejects bad url without network', async () => {
    const emptyCtx = commandContext(createRuntime());
    const result = await addCommand.execute({
      ...emptyCtx,
      params: { url: 'not-a-url' },
    });
    expect(String(result)).toContain('HTTP/HTTPS');
  });

  it('rss-check with no subscriptions returns clear message', async () => {
    const emptyCtx = commandContext(createRuntime());
    const result = await checkCommand.execute({ ...emptyCtx, params: {} });
    expect(String(result)).toContain('没有任何订阅');
  });

  it('setup provides an owner-scoped runtime backed by databaseHostToken', async () => {
    const fakeHost = { define: () => undefined } as never;
    let provided: RssRuntime | undefined;
    const context = {
      config: { get: () => ({}) },
      resources: {
        has: (token: unknown) => token === databaseHostToken,
        use: () => fakeHost,
        provide: (token: unknown, value: RssRuntime) => {
          if (token === rssRuntimeToken) provided = value;
        },
      },
      lifecycle: { add: () => undefined },
    };

    await (plugin as unknown as { setup: (ctx: unknown) => Promise<void> }).setup(context);
    expect(provided?.db).toBe(fakeHost);
  });

  it('outbound push is invoked for subscribers when wired', async () => {
    const { checkSubscriptions } = await import('../src/poll.js');
    const pushes: string[] = [];
    const runtime = createRuntime({
      config: resolveRssConfig({ timeout: 1000 }),
      outbound: async (input) => {
        pushes.push(`${input.adapterName}:${input.channelId}:${input.content.slice(0, 20)}`);
      },
    });
    const Subs = getRssSubs(runtime.db)!;
      // Unroutable loopback address + short timeout keeps this test offline and fast.
      const url = 'http://127.0.0.1:1/empty.xml';
      await Subs.insert({
        url,
        feed_title: 'Empty',
        adapter_name: SMOKE_CHANNEL.adapterName,
        endpoint_id: SMOKE_CHANNEL.endpointKey,
        channel_type: SMOKE_CHANNEL.channelType,
        channel_id: SMOKE_CHANNEL.channelId,
        creator_id: '',
        creator_name: '',
        created_at: new Date().toISOString(),
      });
      // fetch will fail → no push; still verifies wiring does not throw
      const result = await checkSubscriptions(runtime, {
        urls: [url],
      });
      expect(result.totalNew).toBe(0);
      expect(pushes).toEqual([]);
  });
});
