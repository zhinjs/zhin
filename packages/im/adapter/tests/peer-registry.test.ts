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
    expect(() => registry.declareExternal('icqq', '  ')).toThrow(TypeError);
    expect(registry.isReady('a')).toBe(false);
  });

  it('returns a miss instead of throwing on the read path', () => {
    const registry = createPeerRegistry();
    registry.registerEndpoint({}, input('a', '1'));
    expect(registry.lookup('icqq', '')).toBeUndefined();
    expect(registry.lookup('', '1')).toBeUndefined();
    expect(registry.lookup(undefined as never, '1')).toBeUndefined();
    expect(registry.lookup('icqq', {} as never)).toBeUndefined();
    expect(registry.lookup('icqq', null as never)).toBeUndefined();
    expect(registry.lookup('icqq', NaN as never)).toBeUndefined();
    for (const bad of ['', undefined, null, {}]) {
      expect(registry.isReady(bad as never)).toBe(false);
      expect(registry.selfOf(bad as never)).toBeUndefined();
    }
    expect(registry.isReady('undefined')).toBe(false);
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

  it('ignores a stale generation re-reporting after a newer one registered', () => {
    const registry = createPeerRegistry();
    const oldOwner = {};
    const newOwner = {};
    const releaseOld1 = registry.registerEndpoint(oldOwner, input('a', '1'));
    const releaseNew = registry.registerEndpoint(newOwner, input('a', '2'));
    const releaseOld2 = registry.registerEndpoint(oldOwner, input('a', '1'));
    expect(registry.selfOf('a')).toBe('2');
    releaseOld1();
    releaseOld2();
    expect(registry.selfOf('a')).toBe('2');
    expect(registry.lookup('icqq', '2')).toBeDefined();
    releaseNew();
    expect(registry.isReady('a')).toBe(false);
  });

  it('lets the same owner replace its own entry', () => {
    const registry = createPeerRegistry();
    const owner = {};
    registry.registerEndpoint(owner, input('a', '1'));
    registry.registerEndpoint(owner, input('a', '3'));
    expect(registry.selfOf('a')).toBe('3');
    expect(registry.lookup('icqq', '1')).toBeUndefined();
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

  it('keeps the newer activation when the older instance reports first after the newer one', () => {
    const registry = createPeerRegistry();
    const oldOwner = {};
    const newOwner = {};
    registry.reserve(oldOwner);
    registry.reserve(newOwner);
    const releaseNew = registry.registerEndpoint(newOwner, input('a', '2'));
    const releaseOld = registry.registerEndpoint(oldOwner, input('a', '1'));
    expect(registry.selfOf('a')).toBe('2');
    expect(registry.lookup('icqq', '1')).toBeUndefined();
    releaseOld();
    expect(registry.selfOf('a')).toBe('2');
    expect(registry.lookup('icqq', '2')).toBeDefined();
    releaseNew();
    expect(registry.isReady('a')).toBe(false);
  });

  it('reserve is idempotent and does not create entries', () => {
    const registry = createPeerRegistry();
    const a = {};
    const b = {};
    registry.reserve(a);
    registry.reserve(b);
    registry.reserve(a);
    expect(registry.snapshot()).toEqual([]);
    expect(registry.isReady('a')).toBe(false);
    registry.registerEndpoint(b, input('a', '2'));
    registry.registerEndpoint(a, input('a', '1'));
    expect(registry.selfOf('a')).toBe('2');
  });

  it('lets a newer reserved owner replace an older one that reported first', () => {
    const registry = createPeerRegistry();
    const oldOwner = {};
    const newOwner = {};
    registry.reserve(oldOwner);
    registry.registerEndpoint(oldOwner, input('a', '1'));
    registry.reserve(newOwner);
    registry.registerEndpoint(newOwner, input('a', '2'));
    expect(registry.selfOf('a')).toBe('2');
  });
});
