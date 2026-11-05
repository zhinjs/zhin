import {
  agentOf,
  allowsHost,
  attenuate,
  canCall,
  canContact,
  compareTrust,
  isAttenuationOf,
  minTrust,
  rootAuthority,
} from '../src/authority.js';
import {
  ALL,
  NONE,
  TRUST_LEVELS,
  only,
  scopeWithin,
  type AgentCeiling,
  type Authority,
  type AuthorityNarrowing,
  type NameScope,
  type Principal,
  type TrustLevel,
} from '../src/contracts.js';

const human: Principal = { kind: 'human', id: 'u1', trust: 'trusted', venue: { kind: 'group', id: 'g1' } };
const system: Principal = { kind: 'system', id: 'timer:t1', trust: 'master' };

function ceiling(overrides: Partial<AgentCeiling> = {}): AgentCeiling {
  return {
    agent: 'coder',
    tools: ALL,
    contacts: ALL,
    maxTrust: 'master',
    egress: { network: true, hosts: ALL },
    acceptsFrom: ALL,
    ...overrides,
  };
}

function deepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(deepFrozen);
}

describe('trust order', () => {
  it('compares by TRUST_LEVELS order only', () => {
    expect(compareTrust('stranger', 'master')).toBeLessThan(0);
    expect(compareTrust('master', 'trusted')).toBeGreaterThan(0);
    expect(compareTrust('group_member', 'group_member')).toBe(0);
    // alphabetical order would say 'master' < 'stranger'
    expect(compareTrust('stranger', 'master')).toBeLessThan(0);
  });

  it('minTrust returns the lowest level', () => {
    expect(minTrust('master', 'group_member', 'trusted')).toBe('group_member');
    expect(minTrust('trusted')).toBe('trusted');
  });

  it('rejects unknown levels and empty input', () => {
    expect(() => compareTrust('admin' as TrustLevel, 'master')).toThrow(TypeError);
    expect(() => minTrust('admin' as TrustLevel)).toThrow(TypeError);
    expect(() => minTrust()).toThrow(TypeError);
  });
});

describe('rootAuthority', () => {
  it('caps trust at the ceiling and takes scopes from it', () => {
    const c = ceiling({ maxTrust: 'group_member', tools: only(['b', 'a']), contacts: only(['x']), egress: { network: false, hosts: NONE } });
    const auth = rootAuthority(human, c);
    expect(auth.trust).toBe('group_member');
    expect(auth.tools).toEqual(only(['a', 'b']));
    expect(auth.contacts).toEqual(only(['x']));
    expect(auth.egress).toEqual({ network: false, hosts: NONE });
    expect(auth.chain).toEqual([]);
    expect(auth.principal).toEqual(human);
  });

  it('keeps principal trust when below the ceiling', () => {
    expect(rootAuthority(human, ceiling()).trust).toBe('trusted');
  });

  it('puts a human principal first among approvers, deduped, order kept', () => {
    const auth = rootAuthority(human, ceiling(), { approvers: ['a2', 'u1', 'a1', 'a2'] });
    expect(auth.approvers).toEqual(['u1', 'a2', 'a1']);
  });

  it('does not make a system principal an approver', () => {
    expect(rootAuthority(system, ceiling(), { approvers: ['admin'] }).approvers).toEqual(['admin']);
    expect(rootAuthority(system, ceiling()).approvers).toEqual([]);
  });

  it('returns a deeply frozen object and does not mutate inputs', () => {
    const p = structuredClone(human);
    const c = ceiling({ tools: only(['a']) });
    const approvers = ['z'];
    const auth = rootAuthority(p, c, { approvers });
    expect(deepFrozen(auth)).toBe(true);
    expect(Object.isFrozen(p)).toBe(false);
    expect(p).toEqual(human);
    expect(approvers).toEqual(['z']);
  });
});

describe('attenuate', () => {
  const parent = rootAuthority(human, ceiling({ tools: only(['a', 'b', 'c']), contacts: only(['coder', 'reviewer']), egress: { network: true, hosts: only(['h1', 'h2']) } }), { approvers: ['boss'] });

  it('intersects tools and contacts across parent, narrowing and target', () => {
    const child = attenuate(
      parent,
      { tools: only(['a', 'b', 'z']), contacts: only(['reviewer', 'other']) },
      ceiling({ agent: 'reviewer', tools: only(['b', 'c']), contacts: ALL }),
      'coder',
    );
    expect(child.tools).toEqual(only(['b']));
    expect(child.contacts).toEqual(only(['reviewer']));
  });

  it('omitted narrowing keeps the parent (bounded by target)', () => {
    const child = attenuate(parent, {}, ceiling(), 'coder');
    expect(child.tools).toEqual(parent.tools);
    expect(child.contacts).toEqual(parent.contacts);
    expect(child.trust).toBe(parent.trust);
    expect(child.egress).toEqual(parent.egress);
  });

  it('takes the minimum trust of parent, narrowing and target', () => {
    expect(attenuate(parent, { trust: 'group_member' }, ceiling(), 'x').trust).toBe('group_member');
    expect(attenuate(parent, {}, ceiling({ maxTrust: 'stranger' }), 'x').trust).toBe('stranger');
  });

  it('never widens when the narrowing asks for more', () => {
    const child = attenuate(
      parent,
      { tools: ALL, contacts: ALL, trust: 'master', egress: { network: true, hosts: ALL } },
      ceiling(),
      'x',
    );
    expect(child.tools).toEqual(parent.tools);
    expect(child.contacts).toEqual(parent.contacts);
    expect(child.trust).toBe('trusted');
    expect(child.egress).toEqual(parent.egress);

    const offline = attenuate(parent, { egress: { network: false } }, ceiling(), 'x');
    const back = attenuate(offline, { egress: { network: true } }, ceiling(), 'y');
    expect(back.egress.network).toBe(false);
  });

  it('ands network and intersects hosts', () => {
    expect(attenuate(parent, { egress: { network: false } }, ceiling(), 'x').egress.network).toBe(false);
    expect(attenuate(parent, {}, ceiling({ egress: { network: false, hosts: ALL } }), 'x').egress.network).toBe(false);
    const child = attenuate(parent, { egress: { hosts: only(['h2', 'h3']) } }, ceiling({ egress: { network: true, hosts: only(['h2', 'h1']) } }), 'x');
    expect(child.egress).toEqual({ network: true, hosts: only(['h2']) });
  });

  it('copies principal and approvers and extends the chain', () => {
    const child = attenuate(parent, {}, ceiling(), 'coder');
    const grandchild = attenuate(child, {}, ceiling(), 'reviewer#1');
    expect(grandchild.principal).toEqual(parent.principal);
    expect(grandchild.approvers).toEqual(['u1', 'boss']);
    expect(grandchild.chain).toEqual(['coder', 'reviewer#1']);
  });

  it('cannot change approvers or principal via a narrowing', () => {
    const sneaky = { approvers: ['evil'], principal: { kind: 'human', id: 'evil', trust: 'master' } } as unknown as AuthorityNarrowing;
    const child = attenuate(parent, sneaky, ceiling(), 'x');
    expect(child.approvers).toEqual(parent.approvers);
    expect(child.principal).toEqual(parent.principal);
  });

  it('does not mutate inputs and returns a deeply frozen object', () => {
    const p = structuredClone(parent) as Authority;
    const n: AuthorityNarrowing = { tools: only(['a']), egress: { network: false } };
    const c = ceiling({ tools: only(['a', 'b']) });
    const snapshot = structuredClone({ p, n, c });
    const child = attenuate(p, n, c, 'x');
    expect({ p, n, c }).toEqual(snapshot);
    expect(Object.isFrozen(p)).toBe(false);
    expect(deepFrozen(child)).toBe(true);
    expect(child.chain).not.toBe(p.chain);
    expect(child.approvers).not.toBe(p.approvers);
  });
});

describe('isAttenuationOf', () => {
  const parent = attenuate(
    rootAuthority(human, ceiling({ tools: only(['a', 'b']), contacts: only(['coder']), egress: { network: true, hosts: only(['h1']) } }), { approvers: ['boss'] }),
    {},
    ceiling(),
    'root',
  );
  const child = attenuate(parent, { tools: only(['a']) }, ceiling(), 'coder');

  function tamper(patch: Partial<Authority>): Authority {
    return { ...child, ...patch };
  }

  it('accepts a real attenuation step', () => {
    expect(isAttenuationOf(child, parent)).toBe(true);
    expect(isAttenuationOf({ ...structuredClone(child) }, structuredClone(parent))).toBe(true);
  });

  it('rejects widened tools, contacts and egress', () => {
    expect(isAttenuationOf(tamper({ tools: only(['a', 'b', 'c']) }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ tools: ALL }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ contacts: only(['coder', 'other']) }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ egress: { network: true, hosts: ALL } }), parent)).toBe(false);
    const offline = attenuate(parent, { egress: { network: false } }, ceiling(), 'x');
    const reopened = { ...attenuate(offline, {}, ceiling(), 'y'), egress: { network: true, hosts: only(['h1']) } };
    expect(isAttenuationOf(reopened, offline)).toBe(false);
  });

  it('rejects raised or unknown trust', () => {
    expect(isAttenuationOf(tamper({ trust: 'master' }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ trust: 'admin' as TrustLevel }), parent)).toBe(false);
  });

  it('rejects a changed principal', () => {
    expect(isAttenuationOf(tamper({ principal: { ...human, id: 'u2' } }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ principal: { ...human, trust: 'master' } }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ principal: { ...human, venue: { kind: 'dm', id: 'u1' } } }), parent)).toBe(false);
    const { venue: _venue, ...noVenue } = human;
    expect(isAttenuationOf(tamper({ principal: noVenue }), parent)).toBe(false);
  });

  it('rejects changed approvers', () => {
    expect(isAttenuationOf(tamper({ approvers: ['u1'] }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ approvers: ['boss', 'u1'] }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ approvers: ['u1', 'boss', 'coder'] }), parent)).toBe(false);
  });

  it('rejects a rewritten, skipped or unextended chain', () => {
    expect(isAttenuationOf(tamper({ chain: ['other', 'coder'] }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ chain: ['root'] }), parent)).toBe(false);
    expect(isAttenuationOf(tamper({ chain: ['root', 'coder', 'more'] }), parent)).toBe(false);
    expect(isAttenuationOf(parent, parent)).toBe(false);
    const grandchild = attenuate(child, {}, ceiling(), 'reviewer');
    expect(isAttenuationOf(grandchild, parent)).toBe(false);
  });
});

describe('queries', () => {
  const auth = rootAuthority(human, ceiling({ tools: only(['read']), contacts: only(['reviewer']), egress: { network: true, hosts: only(['api.example.com']) } }));

  it('agentOf strips the instance suffix', () => {
    expect(agentOf('reviewer')).toBe('reviewer');
    expect(agentOf('reviewer#42')).toBe('reviewer');
    expect(agentOf('a#b#c')).toBe('a');
  });

  it('canCall / canContact / allowsHost follow the scopes', () => {
    expect(canCall(auth, 'read')).toBe(true);
    expect(canCall(auth, 'write')).toBe(false);
    expect(canContact(auth, 'reviewer')).toBe(true);
    expect(canContact(auth, agentOf('reviewer#7'))).toBe(true);
    expect(canContact(auth, 'coder')).toBe(false);
    expect(allowsHost(auth, 'api.example.com')).toBe(true);
    expect(allowsHost(auth, 'evil.example.com')).toBe(false);
  });

  it('allowsHost is false whenever network is off', () => {
    const offline = rootAuthority(human, ceiling({ egress: { network: false, hosts: ALL } }));
    expect(allowsHost(offline, 'api.example.com')).toBe(false);
  });
});

describe('property: attenuation never widens', () => {
  // mulberry32: small deterministic PRNG
  function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const NAMES = ['a', 'b', 'c', 'd', 'e', 'f'];
  const next = rng(0x48);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const bool = (): boolean => next() < 0.5;
  const scope = (): NameScope => (next() < 0.2 ? ALL : only(NAMES.filter(() => bool())));
  const trust = (): TrustLevel => pick(TRUST_LEVELS);
  const randomCeiling = (): AgentCeiling =>
    ceiling({ agent: pick(NAMES), tools: scope(), contacts: scope(), maxTrust: trust(), egress: { network: bool(), hosts: scope() } });
  const randomNarrowing = (): AuthorityNarrowing => {
    const n: { -readonly [K in keyof AuthorityNarrowing]: AuthorityNarrowing[K] } = {};
    if (bool()) n.tools = scope();
    if (bool()) n.contacts = scope();
    if (bool()) n.trust = trust();
    if (bool()) n.egress = { ...(bool() ? { network: bool() } : {}), ...(bool() ? { hosts: scope() } : {}) };
    return n;
  };
  const randomParent = (): Authority => {
    let auth = rootAuthority(
      { kind: bool() ? 'human' : 'system', id: `p${Math.floor(next() * 5)}`, trust: trust() },
      randomCeiling(),
      { approvers: NAMES.filter(() => next() < 0.2) },
    );
    const depth = Math.floor(next() * 3);
    for (let i = 0; i < depth; i++) auth = attenuate(auth, randomNarrowing(), randomCeiling(), `actor${i}`);
    return auth;
  };

  it('holds for 300 random cases', () => {
    for (let i = 0; i < 300; i++) {
      const parent = randomParent();
      const narrowing = randomNarrowing();
      const target = randomCeiling();
      const before = structuredClone({ parent, narrowing, target });
      const child = attenuate(parent, narrowing, target, 'x');

      expect(isAttenuationOf(child, parent)).toBe(true);
      expect({ parent, narrowing, target }).toEqual(before);
      expect(deepFrozen(child)).toBe(true);

      for (const outer of [parent.tools, narrowing.tools ?? ALL, target.tools]) expect(scopeWithin(child.tools, outer)).toBe(true);
      for (const outer of [parent.contacts, narrowing.contacts ?? ALL, target.contacts]) expect(scopeWithin(child.contacts, outer)).toBe(true);
      for (const outer of [parent.egress.hosts, narrowing.egress?.hosts ?? ALL, target.egress.hosts]) expect(scopeWithin(child.egress.hosts, outer)).toBe(true);
      for (const cap of [parent.trust, narrowing.trust ?? parent.trust, target.maxTrust, parent.principal.trust]) expect(compareTrust(child.trust, cap)).toBeLessThanOrEqual(0);
      if (child.egress.network) {
        expect(parent.egress.network && target.egress.network && narrowing.egress?.network !== false).toBe(true);
      }
      expect(child.approvers).toEqual(parent.approvers);
      expect(child.principal).toEqual(parent.principal);
    }
  });
});
