import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapterFeatureId } from '@zhin.js/adapter';
import {
  resolveRuntimeTurnContextState,
  turnFactCacheSize,
  TURN_FACT_CACHE_MAX_ENTRIES,
  TURN_FACT_CACHE_TTL_MS,
} from '../../../../src/plugin-runtime/agent/turn/request.js';

const conversation = { endpoint: { id: 'endpoint', adapter: 'icqq' }, kind: 'group' as const, id: '100' };

function generation(management: object | undefined, selfUserId = '8596238') {
  const index = { $projection: 'zhin.adapter-index/1', connection: () => ({ selfUserId, management }) };
  return { index, snapshot: { projections: new Map([[adapterFeatureId, index]]) } as never };
}

function port(overrides: Record<string, unknown> = {}) {
  return {
    inspectGroupScene: vi.fn(async () => ({
      name: '测试群', ownerId: '10001', adminIds: ['10002'], memberCount: 42, muteAll: false,
    })),
    inspectGroupMemberProfile: vi.fn(async (_group: string, user: string) => user === '8596238'
      ? { platformRole: 'admin', card: '小智' }
      : { platformRole: 'member', card: '明明', title: '老玩家', mutedUntil: 0 }),
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe('ADR 0041 scene fact resolution', () => {
  it('resolves group, bot and sender facts through the management port', async () => {
    const management = port();
    const { snapshot } = generation(management);
    const signal = new AbortController().signal;
    const state = await resolveRuntimeTurnContextState(snapshot, conversation, signal, '10002');
    expect(state).toEqual({
      bot: { id: '8596238', platformRole: 'admin', nickname: '小智' },
      conversation: { name: '测试群', ownerId: '10001', adminIds: ['10002'], memberCount: 42, muteAll: false },
      sender: { platformRole: 'member', groupNickname: '明明', groupTitle: '老玩家', mutedUntil: 0 },
    });
    expect(management.inspectGroupScene).toHaveBeenCalledExactlyOnceWith('100', signal);
    expect(management.inspectGroupMemberProfile).toHaveBeenCalledTimes(2); // bot + sender
    expect(Object.isFrozen(state?.conversation)).toBe(true);
    expect(Object.isFrozen(state?.sender)).toBe(true);
  });

  it('keeps partial facts and omits what the platform did not report', async () => {
    const management = port({
      inspectGroupScene: vi.fn(async () => ({ name: '只有名字' })),
      inspectGroupMemberProfile: vi.fn(async (_g: string, user: string) => user === '8596238' ? { platformRole: 'member' } : {}),
    });
    const state = await resolveRuntimeTurnContextState(generation(management).snapshot, conversation, new AbortController().signal, '10002');
    expect(state).toEqual({ bot: { id: '8596238', platformRole: 'member' }, conversation: { name: '只有名字' } });
  });

  it('records a muted sender expiry and the bot mute state', async () => {
    const management = port({
      inspectGroupMemberProfile: vi.fn(async (_g: string, user: string) => ({
        platformRole: 'member', mutedUntil: user === '8596238' ? 0 : 1_900_000_000_000,
      })),
    });
    const state = await resolveRuntimeTurnContextState(generation(management).snapshot, conversation, new AbortController().signal, '10002');
    expect(state?.bot?.mutedUntil).toBe(0);
    expect(state?.sender?.mutedUntil).toBe(1_900_000_000_000);
  });

  it('turns scene and sender lookup failures into omitted fields without failing the turn', async () => {
    const management = port({
      inspectGroupScene: vi.fn(async () => { throw new Error('group info timeout'); }),
      inspectGroupMemberProfile: vi.fn(async (_g: string, user: string) => {
        if (user === '10002') throw new Error('member timeout');
        return { platformRole: 'admin' };
      }),
    });
    const { snapshot, index } = generation(management);
    const state = await resolveRuntimeTurnContextState(snapshot, conversation, new AbortController().signal, '10002');
    expect(state).toEqual({ bot: { id: '8596238', platformRole: 'admin' } });
    expect(turnFactCacheSize(index)).toBe(0); // failures are never cached
  });

  it('still reports a failed bot lookup distinctly from the other facts', async () => {
    const management = port({ inspectGroupMemberProfile: vi.fn(async () => { throw new Error('down'); }) });
    const state = await resolveRuntimeTurnContextState(generation(management).snapshot, conversation, new AbortController().signal, '10002');
    expect(state).toEqual({
      bot: { id: '8596238', platformRoleError: 'lookup_failed' },
      conversation: { name: '测试群', ownerId: '10001', adminIds: ['10002'], memberCount: 42, muteAll: false },
    });
  });

  it('rejects instead of hanging when the turn signal aborts mid-lookup', async () => {
    const management = port({ inspectGroupScene: vi.fn(() => new Promise(() => undefined)) });
    const abort = new AbortController();
    const pending = resolveRuntimeTurnContextState(generation(management).snapshot, conversation, abort.signal, '10002');
    abort.abort(new Error('turn retired'));
    await expect(pending).rejects.toThrow('turn retired');
  });

  it('skips the sender lookup for the bot itself and when no sender id is supplied', async () => {
    const management = port();
    const { snapshot } = generation(management);
    const signal = new AbortController().signal;
    await resolveRuntimeTurnContextState(snapshot, conversation, signal, '8596238');
    await resolveRuntimeTurnContextState(snapshot, conversation, signal);
    expect(management.inspectGroupMemberProfile).toHaveBeenCalledTimes(2); // bot only, once per call
  });

  it('does not query anything outside ICQQ groups', async () => {
    const management = port();
    const { snapshot } = generation(management);
    const signal = new AbortController().signal;
    expect(await resolveRuntimeTurnContextState(snapshot, { ...conversation, kind: 'private' }, signal, '10002'))
      .toEqual({ bot: { id: '8596238' } });
    expect(management.inspectGroupScene).not.toHaveBeenCalled();
    expect(management.inspectGroupMemberProfile).not.toHaveBeenCalled();
  });

  it('falls back to the moderation inspector for the bot role when the profile port is absent', async () => {
    const inspectGroupMember = vi.fn(async () => ({ canModerate: false, platformRole: 'owner' as const }));
    const state = await resolveRuntimeTurnContextState(
      generation({ inspectGroupMember }).snapshot, conversation, new AbortController().signal, '10002');
    expect(state).toEqual({ bot: { id: '8596238', platformRole: 'owner' } });
  });

  describe('short in-memory cache', () => {
    it('reuses scene and sender facts within the TTL but always re-reads the bot', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const management = port();
      const { snapshot, index } = generation(management);
      const signal = new AbortController().signal;
      await resolveRuntimeTurnContextState(snapshot, conversation, signal, '10002');
      vi.advanceTimersByTime(TURN_FACT_CACHE_TTL_MS - 1);
      const again = await resolveRuntimeTurnContextState(snapshot, conversation, signal, '10002');
      expect(again?.conversation?.name).toBe('测试群');
      expect(again?.sender?.groupNickname).toBe('明明');
      expect(management.inspectGroupScene).toHaveBeenCalledTimes(1);
      // bot x2 + sender x1
      expect(management.inspectGroupMemberProfile).toHaveBeenCalledTimes(3);
      expect(turnFactCacheSize(index)).toBe(2);
    });

    it('expires entries after the TTL', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const management = port();
      const { snapshot } = generation(management);
      const signal = new AbortController().signal;
      await resolveRuntimeTurnContextState(snapshot, conversation, signal, '10002');
      vi.advanceTimersByTime(TURN_FACT_CACHE_TTL_MS);
      await resolveRuntimeTurnContextState(snapshot, conversation, signal, '10002');
      expect(management.inspectGroupScene).toHaveBeenCalledTimes(2);
    });

    it('is scoped per generation: a new adapter index starts empty', async () => {
      const management = port();
      const first = generation(management);
      const second = generation(management);
      const signal = new AbortController().signal;
      await resolveRuntimeTurnContextState(first.snapshot, conversation, signal, '10002');
      await resolveRuntimeTurnContextState(second.snapshot, conversation, signal, '10002');
      expect(management.inspectGroupScene).toHaveBeenCalledTimes(2);
      expect(turnFactCacheSize(first.index)).toBe(2);
      expect(turnFactCacheSize(second.index)).toBe(2);
    });

    it('stays within its entry bound under many distinct senders', async () => {
      const management = port();
      const { snapshot, index } = generation(management);
      const signal = new AbortController().signal;
      for (let i = 0; i < TURN_FACT_CACHE_MAX_ENTRIES + 50; i += 1) {
        await resolveRuntimeTurnContextState(snapshot, conversation, signal, String(20000 + i));
      }
      expect(turnFactCacheSize(index)).toBeLessThanOrEqual(TURN_FACT_CACHE_MAX_ENTRIES);
      expect(turnFactCacheSize(index)).toBeGreaterThan(TURN_FACT_CACHE_MAX_ENTRIES - 2);
    });
  });
});
