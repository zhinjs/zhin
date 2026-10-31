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
import { canManageConversation } from '@zhin.js/command';
import { SUBSCRIPTION_PERMISSION_DENIED_MESSAGE } from '../src/permission.ts';
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
    const validate = new Ajv2020({ useDefaults: true, strict: true }).addKeyword({ keyword: 'x-i18n', schemaType: 'object', valid: true }).compile(schema);
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
  it('uses current language for commands and retains the subscription language on later edits', async () => {
    let quakes: QuakeSpec[] = [];
    stubFeeds({ cenc: () => [], usgs: () => quakes });
    const fake = await runPluginSetup(plugin, { config: {} });
    try {
      const input = createFakeMessage({ locale: 'en', sender: { id: 'u', roles: ['admin'] } });
      const options = { input, params: { filters: ['5'] }, formatCommand: (path: string) => `/alerts ${path}` };
      const reply = await runCommand(fake, subscribeCommand, options);
      expect(reply).toContain('Subscribed: M5.0+');
      expect(reply).toContain('/alerts 地震 退订');
      await runCommand(fake, subscribeCommand, { ...options, locale: 'zh-CN', params: { filters: ['6'] } });
      expect((await fake.resources.use(earthquakeServiceToken).store.list())[0]).toMatchObject({ locale: 'en', minMagnitude: 6 });
      const result = await runCommand(fake, queryCommand, { input });
      expect(result).toContain('Earthquakes M3.0+');
      expect(result).toContain('no records');
      await fake.clock.advance(2 * 60_000);
      quakes = [liveQuake('locale-test', 1, { magnitude: 6.1 })];
      await fake.clock.advance(2 * 60_000);
      expect(fake.sent).toHaveLength(1);
      expect(fake.sent[0]).toMatchObject({ kind: 'sendTarget', input: { locale: 'en', content: expect.stringContaining('Earthquake'), target: input.conversation } });
    } finally { await fake.dispose(); }
  });

  it('subscribes, shows status, queries, pushes on the cron tick and unsubscribes', async () => {
    let cenc: QuakeSpec[] = [liveQuake('CD.old', 30, { magnitude: 3.1, location: '新疆阿克苏地区库车市', latitude: 41.2, longitude: 83.7 })];
    let usgs: QuakeSpec[] = [];
    stubFeeds({ cenc: () => cenc, usgs: () => usgs });
    const fake = await runPluginSetup(plugin, { config: {} });
    try {
      const message = createFakeMessage({ sender: { id: 'admin-1', name: 'Admin', roles: ['admin'] } });
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
      const reply = await runCommand(fake, subscribeCommand, { input: createFakeMessage({ conversation: { kind: 'private', id: 'u1' } }), params: { filters: ['四川', '5'] } });
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

describe('@zhin.js/plugin-earthquake subscription permissions', () => {
  function groupMessage(roles: string[]) {
    return createFakeMessage({ conversation: { kind: 'group', id: 'g-perm' }, sender: { id: `user-${roles.join('-') || 'member'}`, roles } });
  }

  it('denies ordinary group members with a clear message and leaves no subscription', async () => {
    stubFeeds({ cenc: () => [], usgs: () => [] });
    const fake = await runPluginSetup(plugin, { config: {} });
    try {
      const member = groupMessage([]);
      expect(await runCommand(fake, subscribeCommand, { input: member, params: { filters: ['5'] } })).toBe(SUBSCRIPTION_PERMISSION_DENIED_MESSAGE);
      expect(await runCommand(fake, unsubscribeCommand, { input: member })).toBe(SUBSCRIPTION_PERMISSION_DENIED_MESSAGE);
      // Adapters project ordinary Telegram / Lark members as `member`; KOOK role ids are no longer in roles.
      const adapterMember = groupMessage(['member']);
      expect(await runCommand(fake, subscribeCommand, { input: adapterMember, params: { filters: [] } })).toBe(SUBSCRIPTION_PERMISSION_DENIED_MESSAGE);
      const trusted = groupMessage(['trusted']);
      expect(await runCommand(fake, subscribeCommand, { input: trusted, params: { filters: [] } })).toBe(SUBSCRIPTION_PERMISSION_DENIED_MESSAGE);
      expect(await fake.resources.use(earthquakeServiceToken).store.list()).toEqual([]);
    } finally {
      await fake.dispose();
    }
  });

  it.each([['owner'], ['admin'], ['master']])('allows the group %s to subscribe and unsubscribe', async (role) => {
    stubFeeds({ cenc: () => [], usgs: () => [] });
    const fake = await runPluginSetup(plugin, { config: {} });
    try {
      const message = groupMessage([role]);
      expect(String(await runCommand(fake, subscribeCommand, { input: message, params: { filters: ['6'] } }))).toContain('已订阅');
      expect(await runCommand(fake, unsubscribeCommand, { input: message })).toBe('已取消本会话的地震速报订阅');
    } finally {
      await fake.dispose();
    }
  });

  it('lets anyone subscribe their own private chat', async () => {
    stubFeeds({ cenc: () => [], usgs: () => [] });
    const fake = await runPluginSetup(plugin, { config: {} });
    try {
      const message = createFakeMessage({ conversation: { kind: 'private', id: 'u-private' }, sender: { id: 'u-private', roles: [] } });
      expect(String(await runCommand(fake, subscribeCommand, { input: message, params: { filters: [] } }))).toContain('已订阅');
      expect(await runCommand(fake, unsubscribeCommand, { input: message })).toBe('已取消本会话的地震速报订阅');
    } finally {
      await fake.dispose();
    }
  });

  it('keeps query and status unrestricted for group members', async () => {
    stubFeeds({ cenc: () => [liveQuake('CD.q', 5)], usgs: () => [] });
    const fake = await runPluginSetup(plugin, { config: {} });
    try {
      const member = groupMessage([]);
      expect(String(await runCommand(fake, queryCommand, { input: member, params: {}, options: {} }))).toContain('四川绵阳市北川县');
      expect(String(await runCommand(fake, statusCommand, { input: member }))).toContain('本会话未订阅');
    } finally {
      await fake.dispose();
    }
  });

  it('evaluates the rule with the built-in permit checker', () => {
    expect(canManageConversation({ scene: { id: 'u', type: 'private' }, sender: { id: 'u', role: [] } })).toBe(true);
    expect(canManageConversation({ scene: { id: 'c', type: 'channel' }, sender: { id: 'u', role: ['user'] } })).toBe(false);
    expect(canManageConversation({ scene: { id: 'c', type: 'channel' }, sender: { id: 'u', role: ['admin'] } })).toBe(true);
    expect(canManageConversation({ scene: { id: 'g', type: 'group' } })).toBe(false);
  });
});
