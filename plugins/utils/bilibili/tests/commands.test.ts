import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { databaseHostToken, outboundHostToken, scheduleHostToken } from 'zhin.js';
import plugin from '../plugin.ts';
import subCommand from '../commands/bili/sub/index.ts';
import unsubCommand from '../commands/bili/unsub/index.ts';
import listCommand from '../commands/bili/list/index.ts';
import liveCommand from '../commands/bili/live/index.ts';
import liveStatusTool from '../skills/bilibili/tools/bili_live_status/index.ts';
import listTool from '../skills/bilibili/tools/bili_list_subscriptions/index.ts';
import { BiliApiError } from '../src/api.js';
import { resolveBilibiliConfig } from '../src/config.js';
import { bilibiliRuntimeToken, type BilibiliRuntime } from '../src/runtime.js';
import { SUBSCRIPTION_PERMISSION_DENIED_MESSAGE } from '../src/permission.js';
import { BILI_STATE_TABLE, BILI_SUBS_TABLE, getBiliState, getBiliSubs } from '../src/store.js';
import { biliMessage, commandContext, dyn, harness, live } from './fixtures.js';

describe('@zhin.js/plugin-bilibili commands', () => {
  it('captures subscription language while display commands use the current language and prefix', async () => {
    const h = harness();
    h.client.liveStatus.set('1', live('1', 0));
    const en = { ...commandContext(h.runtime), locale: 'en' as const, formatCommand: (path: string) => `/tools ${path}` };
    expect(await subCommand.execute({ ...en, params: {} })).toContain('/tools bili sub');
    expect(await subCommand.execute({ ...en, params: { uid: '1', kind: 'live' } })).toContain('Subscribed to');
    expect((await getBiliSubs(h.db)!.select())[0]).toMatchObject({ locale: 'en' });
    expect(await listCommand.execute(commandContext(h.runtime))).toContain('当前订阅');
    await subCommand.execute({ ...commandContext(h.runtime), params: { uid: '1', kind: 'all' } });
    expect((await getBiliSubs(h.db)!.select())[0]).toMatchObject({ locale: 'en' });
    h.client.liveStatus.set('1', live('1', 1, 2000));
    await h.watcher.tick();
    expect(h.pushes[0]?.content).toContain('[Live] UP1 is streaming!');
  });

  it('brands every command', () => {
    for (const command of [subCommand, unsubCommand, listCommand, liveCommand]) {
      expect(parseCommandDefinition(command)).toBe(command);
    }
  });

  it('sub → list → change kind → unsub in one conversation', async () => {
    const h = harness();
    h.client.liveStatus.set('1', live('1', 0));
    h.client.dynamics.set('1', [dyn('old', 10)]);
    const ctx = commandContext(h.runtime);

    expect(String(await listCommand.execute(ctx))).toContain('没有订阅');
    const subscribed = String(await subCommand.execute({ ...ctx, params: { uid: 'https://space.bilibili.com/1', kind: 'all' } }));
    expect(subscribed).toContain('订阅成功：测试UP（UID 1）');

    const state = (await getBiliState(h.db)!.select().where({ uid: '1' }))[0]!;
    expect(state).toMatchObject({ live_status: 0, dynamic_ready: 1 });

    expect(String(await subCommand.execute({ ...ctx, params: { uid: '1', kind: 'all' } }))).toContain('无需重复');
    expect(String(await subCommand.execute({ ...ctx, params: { uid: '1', kind: '直播' } }))).toContain('改为：开播');

    const listed = String(await listCommand.execute(ctx));
    expect(listed).toContain('测试UP（UID 1）· 开播');

    const other = commandContext(h.runtime, {}, biliMessage('group', '20002'));
    expect(String(await listCommand.execute(other))).toContain('没有订阅');

    expect(String(await unsubCommand.execute({ ...ctx, params: { uid: '1' } }))).toContain('已取消订阅');
    expect(await getBiliSubs(h.db)!.select()).toEqual([]);
    expect(await getBiliState(h.db)!.select()).toEqual([]);
    expect(String(await unsubCommand.execute({ ...ctx, params: { uid: '1' } }))).toContain('没有订阅');
  });

  it('unsub prunes the dynamic backoff entry only once the last subscriber is gone', async () => {
    const h = harness();
    h.client.liveStatus.set('1', live('1', 0));
    h.client.dynamics.set('1', [dyn('old', 10)]);
    const first = commandContext(h.runtime);
    const second = commandContext(h.runtime, {}, biliMessage('group', '20002'));
    await subCommand.execute({ ...first, params: { uid: '1', kind: 'dynamic' } });
    await subCommand.execute({ ...second, params: { uid: '1', kind: 'dynamic' } });

    h.client.dynamicError = new BiliApiError('http', 'boom', 500);
    await h.watcher.tick();
    expect(h.watcher.backoffStatus()).toHaveLength(1);

    await unsubCommand.execute({ ...first, params: { uid: '1' } });
    expect(h.watcher.backoffStatus()).toHaveLength(1);

    await unsubCommand.execute({ ...second, params: { uid: '1' } });
    expect(h.watcher.backoffStatus()).toEqual([]);
  });

  it('group sub/unsub are limited to the group owner, admins and the bot master', async () => {
    const h = harness();
    const asRole = (roles: string[], kind: 'group' | 'channel' = 'group') =>
      commandContext(h.runtime, {}, biliMessage(kind, '10001', roles));

    const member = asRole([]);
    expect(String(await subCommand.execute({ ...member, params: { uid: '1', kind: 'all' } }))).toBe(SUBSCRIPTION_PERMISSION_DENIED_MESSAGE);
    expect(String(await subCommand.execute({ ...asRole(['member']), params: { uid: '1', kind: 'all' } })))
      .toBe(SUBSCRIPTION_PERMISSION_DENIED_MESSAGE);
    expect(String(await subCommand.execute({ ...asRole(['user', 'trusted']), params: { uid: '1', kind: 'all' } })))
      .toBe(SUBSCRIPTION_PERMISSION_DENIED_MESSAGE);
    expect(String(await subCommand.execute({ ...asRole([], 'channel'), params: { uid: '1', kind: 'all' } })))
      .toBe(SUBSCRIPTION_PERMISSION_DENIED_MESSAGE);
    expect(await getBiliSubs(h.db)!.select()).toEqual([]);

    for (const [index, role] of ['owner', 'admin', 'master'].entries()) {
      const uid = String(index + 1);
      expect(String(await subCommand.execute({ ...asRole([role]), params: { uid, kind: 'all' } }))).toContain('订阅成功');
    }

    // Master flagged by the endpoint via metadata, as the command router projects it.
    const flaggedMaster = commandContext(h.runtime, {}, { ...biliMessage('group', '10001', []), metadata: { isMaster: true } });
    expect(String(await subCommand.execute({ ...flaggedMaster, params: { uid: '4', kind: 'all' } }))).toContain('订阅成功');

    // Members can still read the list, but cannot remove subscriptions.
    expect(String(await listCommand.execute(member))).toContain('UID 1');
    expect(String(await unsubCommand.execute({ ...member, params: { uid: '1' } }))).toBe(SUBSCRIPTION_PERMISSION_DENIED_MESSAGE);
    expect(await getBiliSubs(h.db)!.select().where({ uid: '1' })).toHaveLength(1);
    expect(String(await unsubCommand.execute({ ...asRole(['master']), params: { uid: '1' } }))).toContain('已取消订阅');
  });

  it('anyone can manage their own private conversation and query live rooms', async () => {
    const h = harness();
    h.client.liveStatus.set('1', live('1', 0));
    const priv = commandContext(h.runtime, {}, biliMessage('private', 'u9', [], 'u9'));
    expect(String(await subCommand.execute({ ...priv, params: { uid: '1', kind: 'live' } }))).toContain('订阅成功');
    expect(String(await listCommand.execute(priv))).toContain('UID 1');
    expect(String(await unsubCommand.execute({ ...priv, params: { uid: '1' } }))).toContain('已取消订阅');

    const member = commandContext(h.runtime, {}, biliMessage('group', '10001', []));
    expect(String(await liveCommand.execute({ ...member, params: { room: 'https://live.bilibili.com/100' } }))).toContain('的直播间 100');
  });

  it('validates input, limits and unknown users', async () => {
    const h = harness({ maxPerChannel: 1 });
    const ctx = commandContext(h.runtime);
    expect(String(await subCommand.execute({ ...ctx, params: { uid: 'nope', kind: 'all' } }))).toContain('请提供 UP 主 UID');
    expect(String(await subCommand.execute({ ...ctx, params: { uid: '1', kind: 'xx' } }))).toContain('订阅类型');
    expect(String(await subCommand.execute({ ...ctx, params: { uid: '1', kind: 'all' }, input: { content: 'x' } }))).toContain('私聊、群聊或频道');

    h.client.card = new BiliApiError('not_found', '啥都木有', -404);
    expect(String(await subCommand.execute({ ...ctx, params: { uid: '7', kind: 'all' } }))).toContain('找不到 UID 为 7');

    h.client.card = new BiliApiError('risk', 'risk', -352);
    expect(String(await subCommand.execute({ ...ctx, params: { uid: '8', kind: 'all' } }))).toContain('订阅成功：8');
    expect(String(await subCommand.execute({ ...ctx, params: { uid: '9', kind: 'all' } }))).toContain('上限 (1)');
  });

  it('warns when subscriptions cannot be pushed or persisted', async () => {
    const h = harness({}, false);
    const runtime: BilibiliRuntime = { ...h.runtime, persistent: false };
    const reply = String(await subCommand.execute({ ...commandContext(runtime), params: { uid: '1', kind: 'all' } }));
    expect(reply).toContain('OutboundHost');
    expect(reply).toContain('重启后会丢失');
  });

  it('bili live reports room status', async () => {
    const h = harness();
    h.client.liveStatus.set('1', live('1', 1, Math.floor(h.clock.now / 1000)));
    const ctx = commandContext(h.runtime);
    const reply = String(await liveCommand.execute({ ...ctx, params: { room: 'https://live.bilibili.com/100' } }));
    expect(reply).toContain('UP1 的直播间 100：直播中');
    expect(reply).toContain('https://live.bilibili.com/100');
    expect(String(await liveCommand.execute({ ...ctx, params: { room: 'x' } }))).toContain('请提供直播间号');
    h.client.room = new BiliApiError('not_found', '未找到', 1);
    expect(String(await liveCommand.execute({ ...ctx, params: { room: '5' } }))).toContain('直播间 5 不存在');
  });

  it('agent tools answer from the runtime', async () => {
    const h = harness();
    h.client.liveStatus.set('1', live('1', 1));
    const context = { use: () => h.runtime } as never;
    expect(String(await liveStatusTool.execute({ uid: '1' }, context))).toContain('UP1：直播中');
    expect(String(await liveStatusTool.execute({}, context))).toContain('请提供');
    expect(String(await listTool.execute({}, context))).toContain('暂无');
  });
});

describe('@zhin.js/plugin-bilibili setup', () => {
  it('defines tables, provides runtime and registers the watcher schedule', async () => {
    const defined: string[] = [];
    const jobs: { id: string; cron: string }[] = [];
    const disposers: unknown[] = [];
    let provided: BilibiliRuntime | undefined;
    const send = vi.fn(async () => null);
    const fakeDb = { define: (name: string) => defined.push(name), models: { get: () => undefined } };
    const hosts = new Map<unknown, unknown>([
      [databaseHostToken, fakeDb],
      [outboundHostToken, { send }],
      [scheduleHostToken, { register: (job: { id: string; cron: string }) => { jobs.push(job); return () => undefined; } }],
    ]);
    await (plugin as unknown as { setup: (ctx: unknown) => Promise<void> }).setup({
      signal: new AbortController().signal,
      config: { get: () => ({ pollCron: '*/90 * * * * *' }) },
      resources: {
        has: (token: unknown) => hosts.has(token),
        use: (token: unknown) => hosts.get(token),
        provide: (token: unknown, value: BilibiliRuntime) => { if (token === bilibiliRuntimeToken) provided = value; },
      },
      lifecycle: { add: (dispose: unknown) => disposers.push(dispose) },
    });
    expect(plugin.name).toBe('bilibili');
    expect(defined).toEqual([BILI_SUBS_TABLE, BILI_STATE_TABLE]);
    expect(provided?.persistent).toBe(true);
    expect(provided?.outbound).toBeTypeOf('function');
    await provided!.outbound!({ adapterName: 'sandbox', endpointKey: 'bot1', channelType: 'group',
      channelId: 'room', content: 'Already formatted notification', locale: 'en' });
    expect(send).toHaveBeenCalledWith({ adapter: 'sandbox', endpointKey: 'bot1',
      conversation: { kind: 'group', id: 'room' }, content: 'Already formatted notification', locale: 'en' });
    expect(jobs).toMatchObject([{ id: 'bilibili/watch', cron: '*/90 * * * * *' }]);
    expect(disposers).toHaveLength(1);
  });

  it('falls back to memory without hosts', async () => {
    let provided: BilibiliRuntime | undefined;
    await (plugin as unknown as { setup: (ctx: unknown) => Promise<void> }).setup({
      signal: new AbortController().signal,
      config: { get: () => ({}) },
      resources: { has: () => false, use: () => undefined, provide: (_t: unknown, value: BilibiliRuntime) => { provided = value; } },
      lifecycle: { add: () => undefined },
    });
    expect(provided?.persistent).toBe(false);
    expect(provided?.outbound).toBeNull();
    expect(getBiliSubs(provided!.db)).not.toBeNull();
  });

  it('resolves config defaults and clamps values', () => {
    expect(resolveBilibiliConfig({})).toMatchObject({ pollCron: '0 * * * * *', jitterMs: 15000, maxPerChannel: 20 });
    expect(resolveBilibiliConfig({ jitterMs: -5, maxPerChannel: 9999, live: false })).toMatchObject({ jitterMs: 0, maxPerChannel: 200, live: false });
  });
});
