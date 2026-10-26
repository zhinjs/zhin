import { projectLocaleToken } from 'zhin.js/i18n';
import Parser from 'rss-parser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin from '../plugin.ts';
import addCommand from '../commands/rss-add/[url]/index.ts';
import listCommand from '../commands/rss-list/index.ts';
import removeCommand from '../commands/rss-remove/[url]/index.ts';
import checkCommand from '../commands/rss-check/[[url]]/index.ts';
import { outboundHostToken } from 'zhin.js';
import { CHANNEL_REQUIRED_MESSAGE, UNSUPPORTED_ADDRESS_MESSAGE, extractChannelInfo } from '../src/channel.js';
import { createInMemoryRssDb, getRssSubs } from '../src/db-store.js';
import { resolveRssConfig } from '../src/feed.js';
import { checkSubscriptions } from '../src/poll.js';
import { rssRuntimeToken, type RssRuntime } from '../src/runtime.js';
import { rssMessage } from './message-fixture.js';

const url = 'https://example.com/feed.xml';

function createRuntime(): RssRuntime {
  return { db: createInMemoryRssDb(), config: resolveRssConfig({}), outbound: null };
}

function context(runtime: RssRuntime, input: unknown) {
  return {
    owner: {} as never,
    generation: 4,
    locale: 'zh-CN' as const,
    formatCommand: (path: string) => path,
    config: {},
    args: [],
    params: { url },
    input: input as ReturnType<typeof rssMessage>,
    use: (token: unknown) => {
      if (token === rssRuntimeToken) return runtime;
      throw new Error('unexpected token');
    },
  };
}

function mockFeed(guid: string) {
  return vi.spyOn(Parser.prototype, 'parseURL').mockResolvedValue({
    title: 'Example',
    items: [{ title: 'Update', guid, link: `${url}#${guid}` }],
  });
}

afterEach(() => vi.restoreAllMocks());

describe('RSS canonical conversation addresses', () => {
  it.each(['private', 'group', 'channel'] as const)('extracts %s from public Message fields', (kind) => {
    const input = {
      ...rssMessage('8596238', kind, 'destination'),
      metadata: {
        adapter: 'wrong-adapter', endpoint: 'wrong-bot', channelType: 'private',
        channelId: 'wrong-conversation', senderId: 'wrong-sender', senderName: 'wrong-name',
      },
    };
    expect(extractChannelInfo(input)).toEqual({
      adapterName: 'icqq', endpointKey: '8596238', channelType: kind,
      channelId: 'destination', senderId: '1659488338', senderName: '归雨',
    });
  });

  it('does not depend on capability identity formatting or require a sender', () => {
    const input = rssMessage();
    expect(extractChannelInfo({
      ...input,
      sender: undefined,
      conversation: { ...input.conversation, endpoint: { id: 'opaque-identity', adapter: 'owner' } },
    })).toMatchObject({ adapterName: 'icqq', endpointKey: '8596238', senderId: '', senderName: '' });
  });

  it('accepts addresses with absent optional parent and thread fields', () => {
    const input = rssMessage();
    expect(extractChannelInfo({
      ...input,
      conversation: { ...input.conversation, parent: undefined, threadId: undefined },
    })).toEqual(extractChannelInfo(input));
  });

  describe.each([
    { threadId: 'topic-a' },
    { parent: { kind: 'channel', id: 'guild-a' } },
    { parent: { kind: 'channel', id: 'guild-a' }, threadId: 'topic-a' },
  ])('rejects unsupported routing fields %j', (routing) => {
    const message = rssMessage('bot-a', 'channel', 'base-channel');
    const input = { ...message, conversation: { ...message.conversation, ...routing } };

    it('never drops routing fields when extracting the destination', () => {
      expect(extractChannelInfo(input)).toBeNull();
    });

    it.each([addCommand, listCommand, removeCommand, checkCommand])(
      'does not act on the base channel subscription', async (command) => {
        const runtime = createRuntime();
        const parse = mockFeed('initial');
        const Subs = getRssSubs(runtime.db)!;
        await Subs.insert({
          url, adapter_name: 'icqq', endpoint_id: 'bot-a', channel_type: 'channel', channel_id: 'base-channel',
        });
        const existing = await Subs.select();
        expect(await command.execute(context(runtime, input))).toBe(UNSUPPORTED_ADDRESS_MESSAGE);
        expect(await Subs.select()).toEqual(existing);
        expect(parse).not.toHaveBeenCalled();
      },
    );
  });

  it.each([
    undefined, null, 'message', [], {},
    { ...rssMessage(), clientAdapter: undefined },
    { ...rssMessage(), clientAdapter: {} },
    { ...rssMessage(), endpointId: undefined },
    { ...rssMessage(), endpointId: ' ' },
    { ...rssMessage(), endpointId: 8596238 },
    { ...rssMessage(), conversation: { kind: 'private', id: {} } },
    { ...rssMessage(), conversation: { kind: 'private', id: '' } },
    { ...rssMessage(), conversation: { kind: 'global', id: 'room' } },
    { ...rssMessage(), sender: '1659488338' },
    { ...rssMessage(), sender: { id: {} } },
    { metadata: { adapter: 'icqq', endpoint: '8596238', channelId: 'room' } },
  ])('rejects incomplete or non-IM input %#', (input) => {
    expect(extractChannelInfo(input)).toBeNull();
  });

  it.each([addCommand, listCommand, removeCommand, checkCommand])(
    'rejects context-free calls before reading or writing any global subscription', async (command) => {
      const runtime = createRuntime();
      const parse = mockFeed('initial');
      const Subs = getRssSubs(runtime.db)!;
      await Subs.insert({
        url, adapter_name: 'smoke', endpoint_id: 'local', channel_type: 'private', channel_id: 'global',
      });
      const existing = await Subs.select();
      expect(await command.execute(context(runtime, undefined))).toBe(CHANNEL_REQUIRED_MESSAGE);
      expect(await Subs.select()).toEqual(existing);
      expect(parse).not.toHaveBeenCalled();
    },
  );

  it.each(['private', 'group', 'channel'] as const)(
    'isolates add, list, check and remove for two bots in the same %s conversation', async (kind) => {
      mockFeed('initial');
      const runtime = createRuntime();
      const config = { ...runtime.config, maxPerGroup: 1 };
      const first = { ...context(runtime, rssMessage('bot-a', kind, 'same-room')), config };
      const second = { ...context(runtime, rssMessage('bot-b', kind, 'same-room')), config };
      expect(await addCommand.execute(first)).toContain('订阅成功');
      expect(await listCommand.execute(second)).toContain('没有订阅');
      expect(await checkCommand.execute(second)).toContain('未订阅');
      expect(await removeCommand.execute(second)).toBe('未找到该订阅');
      expect(await addCommand.execute(second)).toContain('订阅成功');
      expect(await addCommand.execute(first)).toContain('无需重复添加');
      expect(await addCommand.execute({ ...first, params: { url: 'https://example.com/second.xml' } }))
        .toContain('订阅数已达上限 (1)');
      const Subs = getRssSubs(runtime.db)!;
      expect((await Subs.select()).map((row) => ({
        endpoint: row.endpoint_id, kind: row.channel_type, id: row.channel_id,
        creator: row.creator_id, name: row.creator_name,
      }))).toEqual([
        { endpoint: 'bot-a', kind, id: 'same-room', creator: '1659488338', name: '归雨' },
        { endpoint: 'bot-b', kind, id: 'same-room', creator: '1659488338', name: '归雨' },
      ]);
      expect(await removeCommand.execute(first)).toContain('已取消订阅');
      expect(await listCommand.execute(first)).toContain('没有订阅');
      expect(await listCommand.execute(second)).toContain('Example');
    },
  );

  it('counts only successful sends and preserves exact addresses through OutboundHost', async () => {
    mockFeed('new-item');
    const send = vi.fn(async (input: { endpointKey: string }) => {
      if (input.endpointKey === 'bot-a') throw new Error('offline');
      return null; // Successful transports may not supply a platform message id.
    });
    let runtime: RssRuntime | undefined;
    await plugin.setup!({
      config: { get: () => ({}) },
      resources: {
        has: (token: unknown) => token === outboundHostToken,
        use: (token: unknown) => token === projectLocaleToken ? 'zh-CN' : ({ send }),
        provide: (token: unknown, value: RssRuntime) => {
          if (token === rssRuntimeToken) runtime = value;
        },
      },
      lifecycle: { add: () => undefined },
    } as never);
    expect(runtime).toBeDefined();
    const Subs = getRssSubs(runtime!.db)!;
    for (const [endpoint, kind, id] of [
      ['bot-a', 'private', 'user'], ['bot-b', 'group', 'group'], ['bot-b', 'channel', 'channel'],
    ]) {
      await Subs.insert({ url, adapter_name: 'icqq', endpoint_id: endpoint, channel_type: kind, channel_id: id });
    }
    // Old/incomplete rows must never be routed by guessing the bot from the adapter.
    await Subs.insert({ url, adapter_name: 'icqq', channel_type: 'private', channel_id: 'old-target' });
    await Subs.insert({ url, adapter_name: 'icqq', endpoint_id: 'bot-b', channel_type: 'invalid', channel_id: 'bad-kind' });
    await Subs.insert({ url, adapter_name: {}, endpoint_id: 'bot-b', channel_type: 'private', channel_id: 'bad-adapter' });
    const result = await checkSubscriptions(runtime!, { urls: [url] });
    expect(result.pushed).toBe(2);
    expect(send.mock.calls.map(([input]) => input)).toEqual([
      { adapter: 'icqq', endpointKey: 'bot-a', conversation: { kind: 'private', id: 'user' }, content: expect.stringContaining('Update') },
      { adapter: 'icqq', endpointKey: 'bot-b', conversation: { kind: 'group', id: 'group' }, content: expect.stringContaining('Update') },
      { adapter: 'icqq', endpointKey: 'bot-b', conversation: { kind: 'channel', id: 'channel' }, content: expect.stringContaining('Update') },
    ]);
  });
});
