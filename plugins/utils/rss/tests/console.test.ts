import { describe, expect, it } from 'vitest';
import { PluginConsoleRpcError, type PluginConsoleRpcCall } from 'zhin.js';
import {
  createRssConsoleRpc,
  getRssSeen,
  getRssSubs,
  resolveRssConfig,
  rssRuntimeToken,
  type RssRuntime,
} from '../src/index.js';
import { createInMemoryRssDb } from '../src/db-store.js';
import { decodeTaskTarget } from 'zhin.js/plugin-runtime';
import RssPage, { meta } from '../pages/index/index.js';

function createCall(runtime?: RssRuntime): PluginConsoleRpcCall {
  return {
    signal: new AbortController().signal,
    runtime: runtime
      ? ({
          owner: 'root/rss',
          generation: 1,
          operator: true,
          project: () => undefined,
          use: (token: unknown) => (token === rssRuntimeToken ? runtime : undefined),
        } as unknown as NonNullable<PluginConsoleRpcCall['runtime']>)
      : undefined,
  };
}

describe('RSS Console RPC & Declarative Page', () => {
  it('exposes status, poll-now, and clean-seen in createRssConsoleRpc and redacts URL credentials', async () => {
    const db = createInMemoryRssDb();
    const subs = getRssSubs(db)!;
    await subs.insert({
      url: 'https://user:secret@example.com/feed.xml',
      feed_title: 'Example Feed',
      adapter_name: 'sandbox',
      endpoint_id: 'bot-1',
      channel_type: 'group',
      channel_id: 'g-100',
      creator_name: 'Alice',
      created_at: '2026-01-01T00:00:00.000Z',
    });

    const seen = getRssSeen(db)!;
    await seen.insert({
      feed_url: 'https://example.com/feed.xml',
      item_guid: 'old-guid',
      item_title: 'Old Item',
      seen_at: '2020-01-01T00:00:00.000Z',
    });

    const runtime: RssRuntime = {
      db,
      config: resolveRssConfig({ pollCron: '0 */10 * * * *', maxItems: 8, timeout: 12000 }),
      outbound: null,
    };

    const rpc = createRssConsoleRpc();
    expect([...rpc.methods.keys()]).toEqual([
      'status',
      'add-subscription',
      'remove-subscription',
      'poll-now',
      'clean-seen',
    ]);
    const statusMethod = rpc.methods.get('status')!;
    expect(statusMethod.page).toBe('index');
    expect(statusMethod.requiredPermissions).toEqual(['rss:read']);

    const status = (await statusMethod.handler({}, createCall(runtime))) as Record<string, unknown>;
    expect(status).toEqual({
      subscriptionCount: 1,
      pollCron: '0 */10 * * * *',
      maxItemsPerPoll: 8,
      fetchTimeoutMs: 12000,
      subscriptions: [
        {
          id: '1',
          feedTitle: 'Example Feed',
          url: 'https://example.com/feed.xml',
          adapterName: 'sandbox',
          endpointId: 'bot-1',
          channelType: 'group',
          channelId: 'g-100',
          creatorName: 'Alice',
          createdAt: '2026-01-01T00:00:00.000Z',
          conversation: 'group:g-100',
        },
      ],
    });

    const cleanSeenMethod = rpc.methods.get('clean-seen')!;
    expect(rpc.methods.get('cleanSeen')).toBe(cleanSeenMethod);
    expect(cleanSeenMethod.page).toBe('index');
    expect(cleanSeenMethod.requiredPermissions).toEqual(['rss:write']);
    const cleanRes = (await cleanSeenMethod.handler({}, createCall(runtime))) as {
      ok: boolean;
      cleanedAt: number;
    };
    expect(cleanRes.ok).toBe(true);
    expect(typeof cleanRes.cleanedAt).toBe('number');
    expect(await seen.select()).toHaveLength(0);

    // Clear subscriptions before poll-now so no network call is needed
    await subs.delete().where({ url: 'https://user:secret@example.com/feed.xml' });
    const pollNowMethod = rpc.methods.get('poll-now')!;
    expect(rpc.methods.get('pollNow')).toBe(pollNowMethod);
    expect(pollNowMethod.page).toBe('index');
    expect(pollNowMethod.requiredPermissions).toEqual(['rss:write']);
    const pollRes = (await pollNowMethod.handler({}, createCall(runtime))) as {
      ok: boolean;
      polledAt: number;
    };
    expect(pollRes.ok).toBe(true);
    expect(typeof pollRes.polledAt).toBe('number');
  });

  it('throws PluginConsoleRpcError when runtime is missing', async () => {
    const rpc = createRssConsoleRpc();
    const statusMethod = rpc.methods.get('status')!;
    await expect(statusMethod.handler({}, createCall())).rejects.toBeInstanceOf(PluginConsoleRpcError);
  });

  it('exports page meta and declarative page component', () => {
    expect(meta).toMatchObject({
      title: 'RSS 订阅',
      titleI18n: { en: 'RSS Subscriptions' },
      icon: 'Rss',
      order: 52,
      requiredPermissions: ['rss:read'],
    });
    expect(typeof RssPage).toBe('function');
  });

  it('adds a subscription to the conversation chosen in the picker, with an exact target (#1250)', async () => {
    const db = createInMemoryRssDb();
    const runtime: RssRuntime = { db, config: resolveRssConfig({}), outbound: null };
    const add = createRssConsoleRpc().methods.get('addSubscription')!;
    const conversation = {
      endpoint: { adapter: 'sandbox', id: 'root/sandbox\u0000zhin.adapter\u0000sandbox~sandbox-bot' },
      kind: 'group',
      id: 'g-200',
    };
    const result = await add.handler({ url: 'https://example.com/a.xml', title: 'A', conversation: JSON.stringify(conversation) }, createCall(runtime)) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: true, conversation });

    const [row] = await getRssSubs(db)!.select();
    expect(row).toMatchObject({ channel_type: 'group', channel_id: 'g-200', creator_name: 'Console' });
    expect(decodeTaskTarget(JSON.parse(String(row!.target_json)) as Record<string, unknown>)).toEqual(conversation);

    const status = await createRssConsoleRpc().methods.get('status')!.handler({}, createCall(runtime)) as { subscriptions: Record<string, unknown>[] };
    expect(status.subscriptions[0]!.conversation).toEqual(conversation);

    await expect(add.handler({ url: 'https://example.com/a.xml', conversation }, createCall(runtime)))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(add.handler({ url: 'https://example.com/b.xml', conversation: { ...conversation, threadId: 't-1' } }, createCall(runtime)))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(add.handler({ url: 'https://example.com/b.xml', conversation: '{oops' }, createCall(runtime)))
      .rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('the page picks the destination with the conversation picker, not free-typed platform / target ids', () => {
    const spec = (RssPage as unknown as { spec: {
      actions: readonly { name: string; fields?: readonly { key: string; type?: string; required?: boolean }[] }[];
      sections: readonly { id?: string; columns?: readonly { key: string; type?: string }[] }[];
    } }).spec;
    const fields = spec.actions.find(action => action.name === 'addSubscription')!.fields!;
    expect(fields.map(field => field.key)).toEqual(['url', 'title', 'conversation']);
    expect(fields.find(field => field.key === 'conversation')).toMatchObject({ type: 'conversation', required: true });
    const columns = spec.sections.find(section => section.id === 'subscriptions')!.columns!;
    expect(columns.find(column => column.key === 'conversation')?.type).toBe('conversation');
  });
});
