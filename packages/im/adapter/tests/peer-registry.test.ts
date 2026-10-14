import {
  createPeerRegistry,
  getProcessPeerRegistry,
  PeerRegistry,
} from '../src/peer-registry.js';

const input = (endpointId: string, selfUserId: string, adapter = 'ICQQ') =>
  ({ endpointId: endpointId as never, adapter, selfUserId });

describe('PeerRegistry', () => {
  it('registers, looks up and normalizes keys', () => {
    const registry = createPeerRegistry();
    registry.registerEndpoint({}, input('a', ' 10001 '));
    const found = registry.lookup('icqq', '10001');
    expect(found).toMatchObject({ adapter: 'icqq', userId: '10001', kind: 'endpoint', endpointIds: ['a'] });
    expect(registry.lookup('ICQQ', ' 10001 ')).toEqual(found);
    expect(registry.isReady('a')).toBe(true);
    expect(registry.selfOf('a')).toBe('10001');
    expect(registry.lookup('icqq', '999')).toBeUndefined();
    expect(registry.isReady('missing')).toBe(false);
  });

  it('rejects empty and non-string ids', () => {
    const registry = createPeerRegistry();
    expect(() => registry.registerEndpoint({}, input('a', ''))).toThrow(TypeError);
    expect(() => registry.registerEndpoint({}, input('a', '   '))).toThrow(TypeError);
    expect(() => registry.registerEndpoint({}, input('a', undefined as never))).toThrow(TypeError);
    expect(() => registry.registerEndpoint({}, input('a', {} as never))).toThrow(TypeError);
    expect(() => registry.lookup('icqq', '')).toThrow(TypeError);
    expect(() => registry.declareExternal('icqq', '  ')).toThrow(TypeError);
    expect(registry.isReady('a')).toBe(false);
  });

  it('merges the same account across endpoints', () => {
    const registry = createPeerRegistry();
    registry.registerEndpoint({}, input('a', '1'));
    registry.registerEndpoint({}, input('b', '1'));
    expect(registry.lookup('icqq', '1')?.endpointIds).toEqual(['a', 'b']);
    expect(registry.snapshot()).toHaveLength(1);
  });

  it('replaces a re-reported endpoint and keeps stale releases harmless', () => {
    const registry = createPeerRegistry();
    const oldOwner = {};
    const newOwner = {};
    const releaseOld = registry.registerEndpoint(oldOwner, input('a', '1'));
    registry.registerEndpoint(newOwner, input('a', '2'));
    expect(registry.selfOf('a')).toBe('2');
    expect(registry.lookup('icqq', '1')).toBeUndefined();
    releaseOld();
    expect(registry.selfOf('a')).toBe('2');
  });

  it('releases its own entry', () => {
    const registry = createPeerRegistry();
    const release = registry.registerEndpoint({}, input('a', '1'));
    release();
    release();
    expect(registry.isReady('a')).toBe(false);
    expect(registry.snapshot()).toEqual([]);
  });

  it('declares external bots', () => {
    const registry = createPeerRegistry();
    const release = registry.declareExternal('Kook', 'bot-9', 'helper');
    expect(registry.lookup('kook', 'bot-9')).toMatchObject({ kind: 'declared', endpointIds: [], label: 'helper' });
    registry.registerEndpoint({}, input('k', 'bot-9', 'kook'));
    expect(registry.lookup('kook', 'bot-9')).toMatchObject({ kind: 'endpoint', label: 'helper' });
    release();
    expect(registry.lookup('kook', 'bot-9')?.label).toBeUndefined();
  });

  it('returns deeply frozen snapshots', () => {
    const registry = createPeerRegistry();
    registry.registerEndpoint({}, input('a', '1'));
    const snapshot = registry.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(Object.isFrozen(snapshot[0].endpointIds)).toBe(true);
    expect(Object.isFrozen(registry.lookup('icqq', '1'))).toBe(true);
  });

  it('exposes a globalThis process singleton', () => {
    expect(getProcessPeerRegistry()).toBe(getProcessPeerRegistry());
    expect(getProcessPeerRegistry()).toBeInstanceOf(PeerRegistry);
    expect(createPeerRegistry()).not.toBe(getProcessPeerRegistry());
  });
});
