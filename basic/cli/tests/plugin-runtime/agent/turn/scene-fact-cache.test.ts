import { describe, expect, it, vi } from 'vitest';
import { adapterFeatureId } from '@zhin.js/adapter';
import { SCENE_FACT_STALE_MS, SceneFactStore, SessionProfileStore } from '@zhin.js/agent';
import type { ConversationEvent } from '@zhin.js/im-contract';
import { resolveRuntimeTurnContextState } from '../../../../src/plugin-runtime/agent/turn/request.js';
import { SceneFactRefresher } from '../../../../src/plugin-runtime/agent/turn/scene-fact-refresher.js';
import { SceneEventIngress } from '../../../../src/plugin-runtime/agent/turn/scene-event-ingress.js';
import { applySceneEventToFacts } from '../../../../src/plugin-runtime/agent/turn/scene-fact-events.js';

const T0 = Date.parse('2026-10-29T02:00:00Z');
const endpoint = { id: 'endpoint', adapter: 'icqq' };
const conversation = { endpoint, kind: 'group' as const, id: '100' };
const BOT = '8596238';

function generation(management: object) {
  const index = { $projection: 'zhin.adapter-index/1', connection: () => ({ selfUserId: BOT, management }) };
  return { index, snapshot: { projections: new Map([[adapterFeatureId, index]]) } as never };
}

function port(overrides: Record<string, unknown> = {}) {
  return {
    inspectGroupScene: vi.fn(async () => ({ name: '测试群', ownerId: '10001', adminIds: ['10002'], memberCount: 42, muteAll: false })),
    inspectGroupMemberProfile: vi.fn(async (_group: string, user: string) => user === BOT
      ? { platformRole: 'admin', card: '小智', mutedUntil: 0 }
      : { platformRole: 'member', card: '明明', title: '老玩家', mutedUntil: 0 }),
    ...overrides,
  };
}

function environment() {
  const clock = { now: T0 };
  const now = () => clock.now;
  const sessions = new SessionProfileStore(now);
  const store = new SceneFactStore(sessions, { now });
  const refresher = new SceneFactRefresher();
  const resolve = (management: object, sender = '10002', abort = new AbortController()) =>
    resolveRuntimeTurnContextState(generation(management).snapshot, conversation, abort.signal, sender, { store, refresher, now });
  return { clock, sessions, store, refresher, resolve };
}

const expectedFacts = {
  bot: { id: BOT, platformRole: 'admin', nickname: '小智', mutedUntil: 0 },
  conversation: { name: '测试群', ownerId: '10001', adminIds: ['10002'], memberCount: 42, muteAll: false },
  sender: { platformRole: 'member', groupNickname: '明明', groupTitle: '老玩家', mutedUntil: 0 },
};

describe('ADR 0041 §6 two-level scene fact cache', () => {
  it('L2 miss: asks the platform and writes both levels', async () => {
    const { store, resolve } = environment();
    const management = port();
    const index = generation(management);
    const state = await resolveRuntimeTurnContextState(index.snapshot, conversation, new AbortController().signal, '10002', { store, now: () => T0 });
    expect(state).toEqual(expectedFacts);
    expect(management.inspectGroupScene).toHaveBeenCalledTimes(1);
    // level 2
    expect((await store.getGroup('endpoint', 'group', '100'))?.facts).toMatchObject({ name: '测试群', ownerId: '10001', memberCount: 42 });
    expect((await store.getMember('endpoint', 'group', '100', '10002'))?.facts).toEqual({ platformRole: 'member', card: '明明', title: '老玩家', mutedUntil: 0 });
    // level 1: the same generation does not touch level 2 or the platform again
    const getGroup = vi.spyOn(store, 'getGroup');
    const getMember = vi.spyOn(store, 'getMember');
    const again = await resolveRuntimeTurnContextState(index.snapshot, conversation, new AbortController().signal, '10002', { store, now: () => T0 + 1000 });
    expect(again).toEqual(expectedFacts);
    expect(getGroup).not.toHaveBeenCalled();
    expect(getMember).not.toHaveBeenCalled();
    expect(management.inspectGroupScene).toHaveBeenCalledTimes(1);
    void resolve;
  });

  it('L1 miss, L2 hit: a new generation reads the database and does not ask the platform for scene or sender', async () => {
    const { store, resolve } = environment();
    await resolve(port());
    const next = port();
    const state = await resolve(next);
    expect(state).toEqual(expectedFacts);
    expect(next.inspectGroupScene).not.toHaveBeenCalled();
    // the bot follows the same cadence as members: level 2 serves it too, no platform call
    expect(next.inspectGroupMemberProfile).not.toHaveBeenCalled();
    expect(store).toBeDefined();
  });

  it('serves an expired mute as not muted', async () => {
    const { store, clock, resolve } = environment();
    await store.putMember('endpoint', 'group', '100', '10002', { platformRole: 'member', mutedUntil: T0 + 60_000 });
    await store.putGroup('endpoint', 'group', '100', { name: '群' });
    clock.now = T0 + 120_000;
    const state = await resolve(port());
    expect(state?.sender).toEqual({ platformRole: 'member', mutedUntil: 0 });
  });

  it('caches the bot like any member and writes it through to both stores', async () => {
    const { store, sessions, resolve } = environment();
    const management = port();
    const index = generation(management);
    const run = () => resolveRuntimeTurnContextState(index.snapshot, conversation, new AbortController().signal, '10002', { store, now: () => T0 });
    await run();
    await run();
    const botCalls = management.inspectGroupMemberProfile.mock.calls.filter(([, user]) => user === BOT);
    expect(botCalls).toHaveLength(1);
    expect((await store.getMember('endpoint', 'group', '100', BOT))?.facts).toEqual({ platformRole: 'admin', card: '小智', mutedUntil: 0 });
    expect(await sessions.get('endpoint', 'group', '100')).toMatchObject({ botRole: 'admin', muteUntil: 0 });
    void resolve;
  });

  it('never lets a level-2 problem fail the turn', async () => {
    const { store, resolve } = environment();
    vi.spyOn(store, 'getGroup').mockRejectedValue(new Error('db read'));
    vi.spyOn(store, 'getMember').mockRejectedValue(new Error('db read'));
    vi.spyOn(store, 'putGroup').mockRejectedValue(new Error('db write'));
    vi.spyOn(store, 'putMember').mockRejectedValue(new Error('db write'));
    vi.spyOn(store, 'putBot').mockRejectedValue(new Error('db write'));
    expect(await resolve(port())).toEqual(expectedFacts);
  });

  it('without a store behaves exactly as before', async () => {
    const management = port();
    const state = await resolveRuntimeTurnContextState(generation(management).snapshot, conversation, new AbortController().signal, '10002');
    expect(state).toEqual(expectedFacts);
  });

  describe('stale rows', () => {
    async function seedStale(env: ReturnType<typeof environment>) {
      await env.resolve(port());
      env.clock.now = T0 + SCENE_FACT_STALE_MS + 1;
    }

    it('serves a row older than 24 h at once and refreshes it once in the background', async () => {
      const env = environment();
      await seedStale(env);
      const fresh = port({
        inspectGroupScene: vi.fn(async () => ({ name: '改名后', ownerId: '10001', memberCount: 43 })),
        inspectGroupMemberProfile: vi.fn(async (_g: string, user: string) => user === BOT ? { platformRole: 'admin' } : { platformRole: 'admin', card: '新名片' }),
      });
      const state = await env.resolve(fresh);
      expect(state?.conversation?.name).toBe('测试群'); // last known value, served immediately
      expect(state?.sender?.groupNickname).toBe('明明');
      await env.refresher.idle();
      expect(fresh.inspectGroupScene).toHaveBeenCalledTimes(1);
      expect((await env.store.getGroup('endpoint', 'group', '100'))).toMatchObject({ updatedAt: env.clock.now, facts: { name: '改名后', memberCount: 43 } });
      expect((await env.store.getMember('endpoint', 'group', '100', '10002'))?.facts).toEqual({ platformRole: 'admin', card: '新名片' });
      // the refreshed row is current: nothing is scheduled again
      const later = port();
      await env.resolve(later);
      await env.refresher.idle();
      expect(later.inspectGroupScene).not.toHaveBeenCalled();
    });

    it('de-duplicates concurrent refreshes of one key', async () => {
      const env = environment();
      await seedStale(env);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const slow = port({ inspectGroupScene: vi.fn(async () => { await gate; return { name: '慢' }; }) });
      await env.resolve(slow);
      await env.resolve(slow); // another generation's turn: its own L1, same stale L2 row
      await env.resolve(slow, '10002');
      expect(env.refresher.pending).toBeGreaterThan(0);
      release();
      await env.refresher.idle();
      expect(slow.inspectGroupScene).toHaveBeenCalledTimes(1);
    });

    it('keeps the last known value when the background refresh fails', async () => {
      const env = environment();
      await seedStale(env);
      const broken = port({
        inspectGroupScene: vi.fn(async () => { throw new Error('timeout'); }),
        inspectGroupMemberProfile: vi.fn(async (_g: string, user: string) => {
          if (user === BOT) return { platformRole: 'admin' };
          throw new Error('timeout');
        }),
      });
      const state = await env.resolve(broken);
      await env.refresher.idle();
      expect(state).toMatchObject({ conversation: { name: '测试群' }, sender: { groupNickname: '明明' } });
      expect((await env.store.getGroup('endpoint', 'group', '100'))?.facts.name).toBe('测试群');
      // still served on the next turn (the row is still stale, so it retries, and still serves)
      expect(await env.resolve(broken)).toMatchObject({ conversation: { name: '测试群' } });
    });

    it('drops pending refreshes when the generation is disposed', async () => {
      const env = environment();
      await seedStale(env);
      let seen: AbortSignal | undefined;
      const hanging = port({
        inspectGroupScene: vi.fn((_g: string, signal: AbortSignal) => { seen = signal; return new Promise(() => undefined); }),
      });
      await env.resolve(hanging);
      await vi.waitFor(() => expect(seen).toBeDefined());
      env.refresher.dispose();
      expect(seen?.aborted).toBe(true);
      await env.refresher.idle();
      expect(env.refresher.pending).toBe(0);
      expect(env.refresher.schedule('x', async () => undefined)).toBe(false);
    });

    it('does not use the turn signal for the background refresh', async () => {
      const env = environment();
      await seedStale(env);
      const turn = new AbortController();
      let seen: AbortSignal | undefined;
      const management = port({ inspectGroupScene: vi.fn(async (_g: string, signal: AbortSignal) => { seen = signal; return { name: '新' }; }) });
      await env.resolve(management, '10002', turn);
      turn.abort(new Error('turn done'));
      await env.refresher.idle();
      expect(seen).not.toBe(turn.signal);
      expect((await env.store.getGroup('endpoint', 'group', '100'))?.facts.name).toBe('新');
    });
  });
});

describe('SceneFactRefresher', () => {
  it('bounds concurrency and queue length, and runs each key once', async () => {
    const refresher = new SceneFactRefresher({ concurrency: 2, maxQueued: 2 });
    const gates: Array<() => void> = [];
    let running = 0;
    let peak = 0;
    const job = () => async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise<void>((resolve) => gates.push(resolve));
      running -= 1;
    };
    expect(refresher.schedule('a', job())).toBe(true);
    expect(refresher.schedule('a', job())).toBe(false);
    expect(refresher.schedule('b', job())).toBe(true);
    expect(refresher.schedule('c', job())).toBe(true);
    expect(refresher.schedule('d', job())).toBe(true);
    expect(refresher.schedule('e', job())).toBe(false); // queue full
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(peak).toBe(2);
    while (refresher.pending > 0) {
      gates.splice(0).forEach((open) => open());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(peak).toBe(2);
    expect(refresher.schedule('a', async () => undefined)).toBe(true); // key is free again
    await refresher.idle();
  });

  it('times a job out', async () => {
    const refresher = new SceneFactRefresher({ timeoutMs: 20 });
    let aborted = false;
    refresher.schedule('slow', (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); })));
    await refresher.idle();
    expect(aborted).toBe(true);
  });
});

describe('side event write-through', () => {
  let seq = 0;
  function signal(type: string, extra: Record<string, unknown>, selfIds: string[] = [BOT]) {
    seq += 1;
    const event = { eventId: `e${seq}`, conversation, timestamp: T0, type, ...extra } as unknown as ConversationEvent;
    return { sequence: seq, event, selfIds } as never;
  }

  async function baseline() {
    const env = environment();
    await env.store.putGroup('endpoint', 'group', '100', { name: '群', ownerId: '10001', adminIds: ['10002'], memberCount: 10, muteAll: false });
    await env.store.putMember('endpoint', 'group', '100', '10003', { platformRole: 'member', card: '旧卡', title: '旧衔', mutedUntil: 0 });
    await env.store.putMember('endpoint', 'group', '100', BOT, { platformRole: 'member', card: '小智', mutedUntil: 0 });
    return env;
  }
  const member = (env: ReturnType<typeof environment>, id = '10003') => env.store.getMember('endpoint', 'group', '100', id).then((row) => row?.facts);
  const group = (env: ReturnType<typeof environment>) => env.store.getGroup('endpoint', 'group', '100').then((row) => row?.facts);

  it('card_changed and title_changed update the member row', async () => {
    const env = await baseline();
    await applySceneEventToFacts(env.store, signal('member.card_changed', { member: { id: '10003' }, value: '新卡' }), () => T0);
    await applySceneEventToFacts(env.store, signal('member.title_changed', { member: { id: '10003' }, value: '' }), () => T0);
    expect(await member(env)).toEqual({ platformRole: 'member', card: '新卡', mutedUntil: 0 });
  });

  it('role_changed updates the member row and the group admins / owner', async () => {
    const env = await baseline();
    await applySceneEventToFacts(env.store, signal('member.role_changed', { member: { id: '10003' }, role: 'admin', enabled: true }), () => T0);
    expect((await member(env))?.platformRole).toBe('admin');
    expect((await group(env))?.adminIds).toEqual(['10002', '10003']);
    await applySceneEventToFacts(env.store, signal('member.role_changed', { member: { id: '10002' }, role: 'admin', enabled: false }), () => T0);
    expect((await group(env))?.adminIds).toEqual(['10003']);
    await applySceneEventToFacts(env.store, signal('member.role_changed', { member: { id: '10003' }, role: 'owner', enabled: true }), () => T0);
    expect(await group(env)).toMatchObject({ ownerId: '10003' });
    expect((await group(env))?.adminIds).toBeUndefined();
  });

  it('role_changed of the bot updates the bot role', async () => {
    const env = await baseline();
    await applySceneEventToFacts(env.store, signal('member.role_changed', { member: { id: BOT }, role: 'admin', enabled: true }), () => T0);
    expect((await member(env, BOT))?.platformRole).toBe('admin');
    expect(await env.sessions.get('endpoint', 'group', '100')).toMatchObject({ botRole: 'admin' });
  });

  it('muted / unmuted update the member row, the bot mute, and the whole-group mute', async () => {
    const env = await baseline();
    await applySceneEventToFacts(env.store, signal('member.muted', { member: { id: '10003' }, durationSeconds: 600 }), () => T0);
    expect((await member(env))?.mutedUntil).toBe(T0 + 600_000);
    await applySceneEventToFacts(env.store, signal('member.unmuted', { member: { id: '10003' } }), () => T0);
    expect((await member(env))?.mutedUntil).toBe(0);
    await applySceneEventToFacts(env.store, signal('member.muted', { member: { id: BOT }, durationSeconds: 60 }), () => T0);
    expect(await env.sessions.get('endpoint', 'group', '100')).toMatchObject({ muteUntil: T0 + 60_000 });
    await applySceneEventToFacts(env.store, signal('member.muted', { member: { id: '0' }, durationSeconds: 0 }), () => T0);
    expect((await group(env))?.muteAll).toBe(true);
    await applySceneEventToFacts(env.store, signal('member.unmuted', { member: { id: 'all' } }), () => T0);
    expect((await group(env))?.muteAll).toBe(false);
  });

  it('joined bumps the member count; left and kicked delete the row and drop the admin', async () => {
    const env = await baseline();
    await applySceneEventToFacts(env.store, signal('member.joined', { member: { id: '10009' } }), () => T0);
    expect((await group(env))?.memberCount).toBe(11);
    expect(await member(env, '10009')).toBeUndefined(); // no baseline from an event alone
    await applySceneEventToFacts(env.store, signal('member.left', { member: { id: '10003' }, reason: 'left' }), () => T0);
    expect(await member(env)).toBeUndefined();
    await applySceneEventToFacts(env.store, signal('member.left', { member: { id: '10002' }, reason: 'removed', actor: { id: '10001' } }), () => T0);
    expect(await group(env)).toMatchObject({ memberCount: 9 });
    expect((await group(env))?.adminIds).toBeUndefined();
  });

  it('ignores unrelated events', async () => {
    const env = await baseline();
    expect(await applySceneEventToFacts(env.store, signal('conversation.poked', { actor: { id: 'a' }, target: { id: 'b' } }), () => T0)).toBe(false);
  });
});

describe('SceneEventIngress write-through hook', () => {
  it('updates the scene facts where it records the state message, even without recordState', async () => {
    const env = environment();
    await env.store.putMember('endpoint', 'group', '100', '10003', { card: '旧卡' });
    const ingress = new SceneEventIngress({
      projectRoot: '/tmp/project',
      triggerConfig: () => ({ enabled: false }),
      reader: () => undefined,
      sessions: () => undefined,
      sceneFacts: () => env.store,
      deliver: vi.fn(async () => ({ status: 'sent' as const })),
      executeTurn: vi.fn() as never,
      timeoutMs: () => 1000,
    });
    const event = { eventId: 'x1', conversation, timestamp: T0, type: 'member.card_changed', member: { id: '10003' }, value: '新卡' } as unknown as ConversationEvent;
    ingress.handle({ sequence: 1, event, selfIds: [BOT] } as never);
    await vi.waitFor(async () => expect((await env.store.getMember('endpoint', 'group', '100', '10003'))?.facts.card).toBe('新卡'));
    const left = { eventId: 'x2', conversation, timestamp: T0, type: 'member.left', member: { id: '10003' }, reason: 'removed' } as unknown as ConversationEvent;
    ingress.handle({ sequence: 2, event: left, selfIds: [BOT] } as never);
    await vi.waitFor(async () => expect(await env.store.getMember('endpoint', 'group', '100', '10003')).toBeUndefined());
    ingress.dispose();
  });
});
