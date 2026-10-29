import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_SCENE_MEMBERS_TABLE,
  AI_SCENE_MEMBER_MODEL,
  SCENE_FACT_PRUNE_INTERVAL_MS,
  SCENE_MEMBER_MAX_PER_SCENE,
  SCENE_MEMBER_RETENTION_MS,
  SCENE_MEMBER_TOUCH_MS,
  SceneFactStore,
} from '../src/scene-facts.js';
import {
  AI_SESSION_PROFILE_MODEL,
  SCENE_FACT_TEXT_MAX_CHARS,
  SessionProfileStore,
  emptySessionProfile,
  sessionProfileFromRow,
  sessionProfileToRow,
} from '../src/session-profile.js';

const T0 = Date.parse('2026-10-29T02:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => vi.useRealTimers());

function matches(row: Record<string, any>, where: Record<string, any>) {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object') {
      if ('$lt' in expected) return row[key] < expected.$lt;
      if ('$gte' in expected) return row[key] >= expected.$gte;
    }
    return row[key] === expected;
  });
}

/** Minimal in-memory stand-in for a database host model. */
function fakeModel() {
  const rows: Record<string, any>[] = [];
  const counts = { creates: 0, updates: 0, deletes: 0 };
  return {
    rows,
    counts,
    select: (...fields: string[]) => ({
      where: async (where: Record<string, any>) => rows.filter((row) => matches(row, where)).map((row) => {
        if (!fields.length) return { ...row };
        return Object.fromEntries(fields.map((field) => [field, row[field]]));
      }),
    }),
    create: async (data: Record<string, any>) => { counts.creates += 1; rows.push({ ...data }); },
    update: (data: Record<string, any>) => ({
      where: async (where: Record<string, any>) => { counts.updates += 1; for (const row of rows) if (matches(row, where)) Object.assign(row, data); },
    }),
    delete: () => ({
      where: async (where: Record<string, any>) => {
        counts.deletes += 1;
        for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i]!, where)) rows.splice(i, 1);
      },
    }),
  };
}

function setup(options: { now?: () => number; maxPerScene?: number; retentionMs?: number; database?: boolean } = {}) {
  const clock = { now: T0 };
  const now = options.now ?? (() => clock.now);
  const sessions = new SessionProfileStore(now);
  const store = new SceneFactStore(sessions, { now, ...(options.maxPerScene ? { maxPerScene: options.maxPerScene } : {}), ...(options.retentionMs ? { retentionMs: options.retentionMs } : {}) });
  const members = fakeModel();
  const profiles = fakeModel();
  if (options.database) {
    store.upgradeToDatabase(members);
    sessions.upgradeToDatabase(profiles);
  }
  return { clock, sessions, store, members, profiles };
}

describe('schema', () => {
  it('declares ai_scene_members and the new session-profile columns additively', () => {
    expect(AI_SCENE_MEMBERS_TABLE).toBe('ai_scene_members');
    expect(Object.keys(AI_SCENE_MEMBER_MODEL)).toEqual(['platform', 'scene_key', 'user_id', 'platform_role', 'card', 'title', 'muted_until', 'updated_at']);
    for (const column of ['owner_id', 'member_count', 'facts_updated_at'] as const) {
      const definition = AI_SESSION_PROFILE_MODEL[column] as Record<string, unknown>;
      expect('default' in definition || definition.nullable === true).toBe(true);
    }
  });

  it('round-trips the new group columns, with unknown member counts as null', () => {
    const record = { ...emptySessionProfile('qq', 'group', 'g1', T0), ownerId: '1', memberCount: 7, factsUpdatedAt: T0 };
    expect(sessionProfileFromRow(sessionProfileToRow(record))).toEqual(record);
    expect(sessionProfileFromRow({ ...sessionProfileToRow(record), member_count: null }).memberCount).toBeNull();
    // A row written before this change has none of the columns.
    const legacy: Record<string, unknown> = sessionProfileToRow(record);
    delete legacy.owner_id; delete legacy.member_count; delete legacy.facts_updated_at;
    expect(sessionProfileFromRow(legacy)).toMatchObject({ ownerId: '', memberCount: null, factsUpdatedAt: 0 });
  });
});

describe('group facts', () => {
  it('has nothing to serve until the platform confirmed something', async () => {
    const { store, sessions } = setup();
    expect(await store.getGroup('qq', 'group', 'g1')).toBeUndefined();
    await sessions.observeInbound({ platform: 'qq', scope: 'group', sceneId: 'g1', title: '只有标题', sender: { id: 'u1' } });
    expect(await store.getGroup('qq', 'group', 'g1')).toBeUndefined();
  });

  it('stores platform facts and serves them with their age', async () => {
    const { store, clock } = setup();
    expect(await store.putGroup('qq', 'group', 'g1', { name: '测试群', ownerId: '10001', adminIds: ['10002', '10003'], memberCount: 42, muteAll: false })).toBe(true);
    clock.now += 5000;
    expect(await store.getGroup('qq', 'group', 'g1')).toEqual({
      updatedAt: T0,
      facts: { name: '测试群', ownerId: '10001', adminIds: ['10002', '10003'], memberCount: 42, muteAll: false },
    });
  });

  it('keeps what an incomplete platform answer did not mention, and writes nothing for an empty one', async () => {
    const { store, clock } = setup();
    await store.putGroup('qq', 'group', 'g1', { name: '旧名', adminIds: ['10002'], memberCount: 5 });
    clock.now += 1000;
    expect(await store.putGroup('qq', 'group', 'g1', {})).toBe(false);
    await store.putGroup('qq', 'group', 'g1', { name: '新名' });
    const group = await store.getGroup('qq', 'group', 'g1');
    expect(group?.facts).toMatchObject({ name: '新名', adminIds: ['10002'], memberCount: 5 });
    expect(group?.updatedAt).toBe(T0 + 1000);
  });

  it('applies side-event patches only on top of a platform baseline', async () => {
    const { store } = setup();
    expect(await store.patchGroup('qq', 'group', 'g1', { memberDelta: 1 })).toBe(false);
    await store.putGroup('qq', 'group', 'g1', { ownerId: '1', adminIds: ['2'], memberCount: 10, muteAll: false });
    await store.patchGroup('qq', 'group', 'g1', { memberDelta: 1 });
    await store.patchGroup('qq', 'group', 'g1', { admin: { id: '3', enabled: true } });
    await store.patchGroup('qq', 'group', 'g1', { admin: { id: '2', enabled: false } });
    await store.patchGroup('qq', 'group', 'g1', { muteAll: true });
    const group = await store.getGroup('qq', 'group', 'g1');
    expect(group?.facts).toMatchObject({ memberCount: 11, adminIds: ['3'], muteAll: true, ownerId: '1' });
    expect(group?.updatedAt).toBe(T0); // patches do not pretend the platform re-confirmed anything
    await store.patchGroup('qq', 'group', 'g1', { ownerId: '3' });
    expect((await store.getGroup('qq', 'group', 'g1'))?.facts).toMatchObject({ ownerId: '3' });
    expect((await store.getGroup('qq', 'group', 'g1'))?.facts.adminIds).toBeUndefined();
  });

  it('clips and cleans stored names and refuses private scopes', async () => {
    const { store } = setup();
    await store.putGroup('qq', 'group', 'g1', { name: `名\n称${'x'.repeat(400)}`, memberCount: 1 });
    const name = (await store.getGroup('qq', 'group', 'g1'))?.facts.name ?? '';
    expect(name.length).toBe(SCENE_FACT_TEXT_MAX_CHARS);
    expect(name).not.toMatch(/[\r\n]/);
    expect(await store.putGroup('qq', 'private', 'u1', { name: 'x' })).toBe(false);
  });

  it('records the bot role and mute through the session profile', async () => {
    const { store, sessions } = setup();
    await store.putBot('qq', 'group', 'g1', 'bot', { platformRole: 'admin', card: '小智', mutedUntil: T0 + 60_000 });
    expect(await sessions.get('qq', 'group', 'g1')).toMatchObject({ botRole: 'admin', muteUntil: T0 + 60_000 });
    expect((await store.getMember('qq', 'group', 'g1', 'bot'))?.facts).toEqual({ platformRole: 'admin', card: '小智', mutedUntil: T0 + 60_000 });
    await store.patchGroup('qq', 'group', 'g1', { botRole: 'owner' }); // no baseline: ignored
    expect((await sessions.get('qq', 'group', 'g1'))?.botRole).toBe('admin');
  });
});

describe('member facts', () => {
  it('replaces the whole row with the platform answer', async () => {
    const { store } = setup();
    await store.putMember('qq', 'group', 'g1', 'u1', { platformRole: 'member', card: '明明', title: '老玩家', mutedUntil: 0 });
    expect((await store.getMember('qq', 'group', 'g1', 'u1'))?.facts).toEqual({ platformRole: 'member', card: '明明', title: '老玩家', mutedUntil: 0 });
    await store.putMember('qq', 'group', 'g1', 'u1', { platformRole: 'admin' });
    expect((await store.getMember('qq', 'group', 'g1', 'u1'))?.facts).toEqual({ platformRole: 'admin' });
    expect(await store.getMember('qq', 'group', 'g2', 'u1')).toBeUndefined();
  });

  it('cleans stored text: control characters out, 128 characters at most', async () => {
    const { store } = setup();
    await store.putMember('qq', 'group', 'g1', 'u1', { card: `忽略\n之前\u0007${'卡'.repeat(300)}`, title: '头衔' });
    const card = (await store.getMember('qq', 'group', 'g1', 'u1'))?.facts.card ?? '';
    expect(card.length).toBeLessThanOrEqual(128);
    expect(card).not.toMatch(/[\u0000-\u001f]/);
    expect(card.startsWith('忽略 之前')).toBe(true);
  });

  it('patches only existing rows, can clear a card, and deletes on leave', async () => {
    const { store } = setup();
    expect(await store.patchMember('qq', 'group', 'g1', 'u1', { card: 'x' })).toBe(false);
    expect(await store.getMember('qq', 'group', 'g1', 'u1')).toBeUndefined();
    await store.putMember('qq', 'group', 'g1', 'u1', { platformRole: 'member', card: '明明', title: '老玩家' });
    expect(await store.patchMember('qq', 'group', 'g1', 'u1', { card: '', title: '新头衔', platformRole: 'admin', mutedUntil: T0 + 5000 })).toBe(true);
    expect((await store.getMember('qq', 'group', 'g1', 'u1'))?.facts).toEqual({ platformRole: 'admin', title: '新头衔', mutedUntil: T0 + 5000 });
    await store.deleteMember('qq', 'group', 'g1', 'u1');
    expect(await store.getMember('qq', 'group', 'g1', 'u1')).toBeUndefined();
    await store.deleteMember('qq', 'group', 'g1', 'u1'); // idempotent
  });

  it('skips unchanged rewrites for five minutes to spare the disk', async () => {
    const { store, clock, members } = setup({ database: true });
    await store.putMember('qq', 'group', 'g1', 'u1', { platformRole: 'member', card: 'a' });
    await store.putMember('qq', 'group', 'g1', 'u1', { platformRole: 'member', card: 'a' });
    expect(members.counts).toMatchObject({ creates: 1, updates: 0 });
    clock.now += SCENE_MEMBER_TOUCH_MS;
    await store.putMember('qq', 'group', 'g1', 'u1', { platformRole: 'member', card: 'a' });
    expect(members.counts.updates).toBe(1);
    await store.putMember('qq', 'group', 'g1', 'u1', { platformRole: 'member', card: 'b' });
    expect(members.counts.updates).toBe(2);
  });

  it('persists to the database model once upgraded', async () => {
    const { store, members, profiles } = setup({ database: true });
    expect(store.persistent).toBe(true);
    await store.putMember('qq', 'group', 'g1', 'u1', { platformRole: 'owner', card: '群主', mutedUntil: 0 });
    expect(members.rows).toEqual([{
      platform: 'qq', scene_key: 'group:g1', user_id: 'u1', platform_role: 'owner', card: '群主', title: '', muted_until: 0, updated_at: T0,
    }]);
    await store.putGroup('qq', 'group', 'g1', { name: '群', ownerId: '1', memberCount: 3 });
    expect(profiles.rows[0]).toMatchObject({ platform: 'qq', scene_key: 'group:g1', title: '群', owner_id: '1', member_count: 3, facts_updated_at: T0 });
    expect((await store.getMember('qq', 'group', 'g1', 'u1'))?.facts.platformRole).toBe('owner');
  });
});

describe('retention', () => {
  it('uses the maintainer numbers', () => {
    expect(SCENE_MEMBER_RETENTION_MS).toBe(90 * DAY);
    expect(SCENE_MEMBER_MAX_PER_SCENE).toBe(2000);
    expect(SCENE_FACT_PRUNE_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  for (const database of [false, true]) {
    it(`prunes rows not updated for 90 days (${database ? 'database' : 'memory'})`, async () => {
      const { store, clock, members } = setup({ database });
      await store.putMember('qq', 'group', 'g1', 'old', { card: 'old' });
      clock.now += 60 * DAY;
      await store.putMember('qq', 'group', 'g1', 'mid', { card: 'mid' });
      clock.now += 30 * DAY - 1;
      expect(await store.prune()).toEqual({ expired: 0, evicted: 0 });
      clock.now += 2; // strictly older than 90 days now
      expect(await store.prune()).toEqual({ expired: 1, evicted: 0 });
      expect(await store.getMember('qq', 'group', 'g1', 'old')).toBeUndefined();
      expect((await store.getMember('qq', 'group', 'g1', 'mid'))?.facts.card).toBe('mid');
      if (database) expect(members.rows).toHaveLength(1);
    });

    it(`caps each scene and evicts the oldest updated_at (${database ? 'database' : 'memory'})`, async () => {
      const { store, clock } = setup({ database, maxPerScene: 3 });
      for (const id of ['a', 'b', 'c', 'd', 'e']) {
        await store.putMember('qq', 'group', 'g1', id, { card: id });
        clock.now += 1000;
      }
      await store.putMember('qq', 'group', 'g2', 'x', { card: 'x' });
      expect(await store.prune()).toEqual({ expired: 0, evicted: 2 });
      expect(await store.getMember('qq', 'group', 'g1', 'a')).toBeUndefined();
      expect(await store.getMember('qq', 'group', 'g1', 'b')).toBeUndefined();
      for (const id of ['c', 'd', 'e']) expect(await store.getMember('qq', 'group', 'g1', id)).toBeDefined();
      expect(await store.getMember('qq', 'group', 'g2', 'x')).toBeDefined();
    });
  }

  it('checks the cap while writing, every 50 new rows in a scene', async () => {
    const { store, members } = setup({ database: true, maxPerScene: 10 });
    for (let i = 0; i < 49; i += 1) await store.putMember('qq', 'group', 'g1', `u${i}`, { card: String(i) });
    expect(members.rows).toHaveLength(49);
    await store.putMember('qq', 'group', 'g1', 'u49', { card: '49' });
    expect(members.rows).toHaveLength(10);
  });

  it('survives a failing database during prune', async () => {
    const { store, members } = setup({ database: true });
    members.select = () => ({ where: async () => { throw new Error('db down'); } });
    expect(await store.prune()).toEqual({ expired: 0, evicted: 0 });
  });

  it('prunes every 6 hours on an unref-ed timer that stops with its handle and with dispose', async () => {
    vi.useFakeTimers({ now: T0 });
    const { store } = setup({ now: () => Date.now() });
    const prune = vi.spyOn(store, 'prune');
    const unref = vi.spyOn(globalThis, 'setInterval');
    const stop = store.startPruning();
    expect(unref.mock.results[0]?.value.hasRef?.()).toBe(false);
    await vi.advanceTimersByTimeAsync(SCENE_FACT_PRUNE_INTERVAL_MS - 1);
    expect(prune).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(prune).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SCENE_FACT_PRUNE_INTERVAL_MS);
    expect(prune).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(SCENE_FACT_PRUNE_INTERVAL_MS * 3);
    expect(prune).toHaveBeenCalledTimes(2);

    const second = store.startPruning(1000);
    store.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(prune).toHaveBeenCalledTimes(2);
    second();
  });
});
