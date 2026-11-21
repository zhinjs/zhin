import { describe, expect, it, vi } from 'vitest';
import { childPluginId, encodeStorageIdentity, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { simulatedConsoleSpeakerToken } from '@zhin.js/adapter';
import { chatRolesToken } from '@zhin.js/core';
import { createFeatureHost, RECENT_EVENT_WINDOW } from '../../src/instance/feature-host-installer.js';

describe('feature host recent conversations', () => {
  it('scans only the newest events by id, newest first, deduplicated and bounded', async () => {
    const qq = childPluginId(rootPluginId(), 'qq');
    // Oldest first, as stored; the newest event for group:1 is id 5.
    const events = [
      { id: 1, time: 100, endpoint_id: 'ep', conversation_kind: 'group', conversation_id: '1' },
      { id: 2, time: 200, endpoint_id: 'ep', conversation_kind: 'group', conversation_id: '2' },
      { id: 3, time: 300, endpoint_id: 'unknown', conversation_kind: 'group', conversation_id: '9' },
      { id: 4, time: 400, endpoint_id: 'ep', conversation_kind: 'private', conversation_id: 'u/1' },
      { id: 5, time: 500, endpoint_id: 'ep', conversation_kind: 'group', conversation_id: '1' },
    ].map(row => ({ ...row, endpoint_id: encodeStorageIdentity(row.endpoint_id), conversation_id: encodeStorageIdentity(row.conversation_id) }));
    const queries: { fields: string[]; order?: [string, string | undefined]; limit?: number }[] = [];
    const model = {
      select(...fields: string[]) {
        const query: { fields: string[]; order?: [string, string | undefined]; limit?: number } = { fields };
        queries.push(query);
        const chain = {
          orderBy(field: string, direction?: 'ASC' | 'DESC') { query.order = [field, direction]; return chain; },
          limit(count: number) { query.limit = count; return chain; },
          then(resolve: (rows: Record<string, unknown>[]) => unknown, reject?: (error: unknown) => unknown) {
            const sorted = query.order?.[1] === 'DESC' ? [...events].reverse() : events;
            return Promise.resolve(sorted.slice(0, query.limit)).then(resolve, reject);
          },
        };
        return chain;
      },
    };
    const snapshot = {
      tree: new Map([[qq, { instanceKey: 'qq' }]]),
      projections: new Map([[featureId('zhin.adapter'), {
        owner: (id: string) => { if (id !== 'ep') throw new Error('unknown'); return qq; },
        endpointEntry: () => ({ desired: { endpointId: 'bot-1' } }),
      }]]),
    };
    const host = createFeatureHost({
      database: { dialect: 'memory', started: true, getRawDatabase: () => ({ models: new Map([['conversation_events', model]]) }) } as never,
      hostConfig: {},
      snapshots: () => ({ acquire: () => ({ value: snapshot, release() {} }) }) as never,
    });
    const recent = await host.stores.recentConversations!(10);
    expect(recent).toEqual([
      { key: 'qq/bot-1/group:1', lastActiveAt: 500 },
      { key: 'qq/bot-1/private:u%2F1', lastActiveAt: 400 },
      { key: 'qq/bot-1/group:2', lastActiveAt: 200 },
    ]);
    expect(queries[0]).toMatchObject({ order: ['id', 'DESC'], limit: RECENT_EVENT_WINDOW });
    expect(await host.stores.recentConversations!(1)).toEqual([{ key: 'qq/bot-1/group:1', lastActiveAt: 500 }]);
  });

  it('reports the store as unavailable without a conversation event model', async () => {
    const host = createFeatureHost({ database: { dialect: 'memory', started: false } as never, hostConfig: {}, snapshots: () => ({}) as never });
    await expect(host.stores.recentConversations!(10)).rejects.toThrow('unavailable');
  });
});

describe('feature host generations (#1250)', () => {
  it('provides the Sandbox identity port Root-side only, and refreshes the owner claim every generation (L3, M2)', async () => {
    const host = createFeatureHost({ database: { dialect: 'memory', started: false } as never, hostConfig: {},
      snapshots: () => ({ acquire: () => ({ value: { tree: new Map(), projections: new Map() }, release() {} }) }) as never });
    const refresh = vi.spyOn(host.claim, 'refresh').mockResolvedValue(undefined);
    vi.spyOn(host.stores.overrides, 'load').mockResolvedValue(undefined as never);
    vi.spyOn(host.roles.store, 'load').mockResolvedValue(undefined as never);
    const generation = async () => {
      const provided = new Map<unknown, unknown>();
      const handoffs: { activateNext(signal: AbortSignal): Promise<void> }[] = [];
      host.install({ context: {} as never })({
        resources: { provide: (token: unknown, value: unknown) => { provided.set(token, value); } },
        handoff: { add: (handoff: typeof handoffs[number]) => { handoffs.push(handoff); } },
        hasFeature: () => false, addFeature: () => undefined, readCandidateSnapshot: () => undefined,
      } as never);
      for (const handoff of handoffs) await handoff.activateNext(new AbortController().signal);
      return provided;
    };
    const first = await generation();
    expect(first.get(simulatedConsoleSpeakerToken)).toEqual({ ensure: expect.any(Function) });
    // Not on the plugin-wide reader.
    expect('ensureConsoleSpeaker' in (first.get(chatRolesToken) as object)).toBe(false);
    await generation();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(host.roles.store.load).toHaveBeenCalledTimes(1);
  });
});
