import { describe, expect, it, vi } from 'vitest';
import { adapterFeatureId } from '@zhin.js/adapter';
import { ImRuntime } from '../../src/plugin-runtime/im/im-runtime.js';

describe('ImRuntime Bot standing resolver (ADR 0056 §1 / §5)', () => {
  it('answers bot:* permits from the Adapter index cache for the message conversation', async () => {
    const selfStanding = vi.fn(async (_id: string, conversation: { id: string }, options: { cachedOnly?: boolean }) =>
      options.cachedOnly ? undefined : conversation.id === 'g1' ? { standing: 'admin' as const } : { standing: 'member' as const });
    const adapters = { $projection: 'zhin.adapter-index/1', selfStanding, invalidateSelfStanding: vi.fn() };
    const value = { projections: new Map([[adapterFeatureId, adapters]]) };
    const lease = { value, active: true, release: () => undefined };
    const im = new ImRuntime();
    im.attach({ acquire: () => lease, retain: () => lease, owns: () => true } as never);
    const source = (id: string) => ({ conversation: { endpoint: { id: 'ep', adapter: 'x' }, kind: 'group', id }, sender: { id: 'u' } });
    const subject = { scene: { id: 'g1', type: 'group' }, sender: { id: 'u' } };
    expect(await im.permissionHost.checkAll(['bot:admin'], subject, { source: source('g1') })).toBe(true);
    expect(await im.permissionHost.checkAll(['bot:admin'], subject, { source: source('g2') })).toBe(false);
    expect(await im.permissionHost.checkAll(['bot:admin'], subject, { source: source('g1'), cachedOnly: true })).toBe(false);
    expect(selfStanding).toHaveBeenCalledWith('ep', expect.objectContaining({ id: 'g1' }), { cachedOnly: true });
    // No conversation, no lookup.
    expect(await im.permissionHost.checkAll(['bot:admin'], subject, { source: {} })).toBe(false);
    expect(selfStanding).toHaveBeenCalledTimes(3);
  });
});
