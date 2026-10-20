import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { createFakeMessage, runCommand, runPluginSetup } from '@zhin.js/testing';
import { parseCommandDefinition } from 'zhin.js/command';
import schema from '../schema.json' with { type: 'json' };
import plugin from '../plugin.ts';
import queryCommand from '../commands/地震/index.ts';
import subscribeCommand from '../commands/地震/订阅/index.ts';
import unsubscribeCommand from '../commands/地震/退订/index.ts';
import statusCommand from '../commands/地震/订阅状态/index.ts';
import recentTool from '../skills/earthquake/tools/recent_earthquakes/index.ts';
import { DEFAULT_EARTHQUAKE_CONFIG, resolveEarthquakeConfig } from '../src/config.js';
import { extractConversation } from '../src/conversation.js';
import { earthquakeServiceToken } from '../src/runtime.js';
import { jsonResponse, MIRROR_URL, mirrorBody, OFFICIAL_URL, statusResponse, USGS_URL, usgsBody, type QuakeSpec } from './fixtures.js';

function liveQuake(id: string, minutesAgo: number, overrides: Partial<QuakeSpec> = {}): QuakeSpec {
  return {
    id,
    time: Date.now() - minutesAgo * 60_000,
    latitude: 31.9,
    longitude: 104.46,
    magnitude: 5.6,
    location: '四川绵阳市北川县',
    ...overrides,
  };
}

function stubFeeds(feeds: { cenc: () => QuakeSpec[]; usgs: () => QuakeSpec[] }) {
  const fetch = vi.fn(async (url: string) => {
    if (url === MIRROR_URL) return jsonResponse(mirrorBody(feeds.cenc()));
    if (url === USGS_URL) return jsonResponse(usgsBody(feeds.usgs()));
    if (url === OFFICIAL_URL) return statusResponse(503);
    throw new TypeError(`unexpected url ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('@zhin.js/plugin-earthquake definition', () => {
  it('defines the plugin and its convention files', () => {
    expect(plugin.name).toBe('earthquake');
    for (const command of [queryCommand, subscribeCommand, unsubscribeCommand, statusCommand]) {
      expect(parseCommandDefinition(command)).toBe(command);
    }
    expect(recentTool.keywords).toContain('地震');
    expect(typeof recentTool.execute).toBe('function');
  });

  it('publishes a strict schema whose defaults match the runtime defaults', () => {
    const validate = new Ajv2020({ useDefaults: true, strict: true }).compile(schema);
    const filled: Record<string, unknown> = {};
    expect(validate(filled)).toBe(true);
    expect(filled).toEqual({ ...DEFAULT_EARTHQUAKE_CONFIG });
    expect(validate({ unknown: true })).toBe(false);
    expect(validate({ cencUrls: ['http://insecure.example'] })).toBe(false);
  });

  it('clamps out-of-range config instead of trusting it', () => {
    const config = resolveEarthquakeConfig({
      requestTimeoutMs: 5,
      maxRetries: 99,
      pushLimit: 0,
      sources: ['usgs', 'nope', 'usgs'],
      cencUrls: ['http://insecure.example', ' https://mirror.example/cenc.json '],
    });
    expect(config.requestTimeoutMs).toBe(1_000);
    expect(config.maxRetries).toBe(5);
    expect(config.pushLimit).toBe(1);
    expect(config.sources).toEqual(['usgs']);
    expect(config.cencUrls).toEqual(['https://mirror.example/cenc.json']);
  });

  it('rejects an unknown timezone at setup', async () => {
    await expect(runPluginSetup(plugin, { config: { timezone: 'Mars/Olympus' } })).rejects.toThrow('timezone 无效');
  });

  it('reads destinations from public message fields only', () => {
    expect(extractConversation(createFakeMessage())).toMatchObject({
      adapter: 'test',
      endpointKey: 'test',
      conversationKind: 'group',
      conversationId: 'test-group',
    });
    expect(extractConversation({ conversation: { kind: 'group', id: 'g', threadId: 't', endpoint: { id: 'e', adapter: 'a' } } })).toBeNull();
    expect(extractConversation(undefined)).toBeNull();
  });
});

describe('@zhin.js/plugin-earthquake runtime', () => {
  it('subscribes, shows status, queries, pushes on the cron tick and unsubscribes', async () => {
    let cenc: QuakeSpec[] = [liveQuake('CD.old', 30, { magnitude: 3.1, location: '新疆阿克苏地区库车市', latitude: 41.2, longitude: 83.7 })];
    let usgs: QuakeSpec[] = [];
    stubFeeds({ cenc: () => cenc, usgs: () => usgs });
    const fake = await runPluginSetup(plugin, { config: {} });
    try {
      const message = createFakeMessage();
      const subscribed = await runCommand(fake, subscribeCommand, { input: message, params: { filters: ['5', '中国'] } });
      expect(String(subscribed)).toContain('已订阅：M5.0 以上，地区：中国');

      const status = await runCommand(fake, statusCommand, { input: message });
      expect(String(status)).toContain('本会话订阅：M5.0 以上');
      expect(String(status)).toContain('CENC：尚未请求');

      const query = await runCommand(fake, queryCommand, { input: message, params: {}, options: { min: 3 } });
      expect(String(query)).toContain('新疆阿克苏地区库车市');

      // First tick is a baseline; nothing is pushed.
      await fake.clock.advance(2 * 60_000);
      expect(fake.sent).toHaveLength(0);

      cenc = [...cenc, liveQuake('CD.new', 1)];
      usgs = [liveQuake('us-new', 1, { magnitude: 6.1, location: '31 km NW of Jiangyou, China', latitude: 31.95 })];
      await fake.clock.advance(2 * 60_000);
      expect(fake.sent).toHaveLength(1);
      expect(JSON.stringify(fake.sent[0])).toContain('四川绵阳市北川县');

      await fake.clock.advance(2 * 60_000);
      expect(fake.sent).toHaveLength(1);

      const removed = await runCommand(fake, unsubscribeCommand, { input: message });
      expect(removed).toBe('已取消本会话的地震速报订阅');
      expect(await runCommand(fake, unsubscribeCommand, { input: message })).toBe('本会话没有地震速报订阅');
    } finally {
      await fake.dispose();
    }
  });

  it('answers the Agent tool and degrades gracefully when every source is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => statusResponse(503)));
    const fake = await runPluginSetup(plugin, { config: { maxRetries: 0 } });
    try {
      const service = fake.resources.use(earthquakeServiceToken);
      const text = await recentTool.execute({ region: '四川' }, { use: <T>(token: { id: string }) => fake.resources.use(token as never) as T } as never);
      expect(String(text)).toContain('暂时无法获取地震数据');
      expect(service.health().every((health) => health.consecutiveFailures === 1)).toBe(true);
    } finally {
      await fake.dispose();
    }
  });

  it('rejects malformed subscribe arguments and missing conversations', async () => {
    stubFeeds({ cenc: () => [], usgs: () => [] });
    const fake = await runPluginSetup(plugin, { config: {} });
    try {
      const reply = await runCommand(fake, subscribeCommand, { input: createFakeMessage(), params: { filters: ['四川', '5'] } });
      expect(String(reply)).toContain('最小震级请写在地区之前');
      const noConversation = await runCommand(fake, unsubscribeCommand, {
        input: { ...createFakeMessage(), conversation: { kind: 'group', id: 'g', threadId: 't', endpoint: { id: 'e', adapter: 'a' } } } as never,
      });
      expect(String(noConversation)).toContain('话题');
    } finally {
      await fake.dispose();
    }
  });
});
