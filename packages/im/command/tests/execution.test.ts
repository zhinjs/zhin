import { createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { CommandIndex, commandFeatureId, defineCommand, CommandExecutionLimitedError, type CommandExecutionPolicy } from '../src/index.js';
import { CommandExecutionBudget, commandExecutionAdmissionToken } from '../src/execution-runtime.js';

function setup(capacity = 10) {
  const root = rootPluginId();
  let now = 100;
  const budget = new CommandExecutionBudget({ capacity, clock: () => now });
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [] }]]),
    resources: new Map([[root, new Map([[commandExecutionAdmissionToken.id, budget.admission]])]]), config: new Map([[root, {}]]), capabilities: new Map(), projections: new Map() };
  const snapshot = createSnapshotView(0, state);
  const retirement = new AbortController();
  const conversation = { endpoint: { adapter: 'test', id: 'account' }, kind: 'private', id: 'user' };
  const open = (senderId: string | undefined = 'alice', scope = conversation) => {
    const control = budget.openOperation({ snapshot, conversation: scope, senderId, retirementSignal: retirement.signal, reply: async () => {} });
    const source = Object.freeze({}); control.bind(source, root);
    return { source, control };
  };
  const admit = (source: unknown, policy: CommandExecutionPolicy = { maxConcurrent: 1 }, capability = 'command') => budget.admission.admit(source, capability, root, policy, snapshot);
  return { budget, snapshot, root, retirement, open, admit, setNow: (value: number) => { now = value; } };
}

describe('command execution policy', () => {
  it.each([{}, null, [], { cooldownMs: 0 }, { cooldownMs: -1 }, { cooldownMs: 1.5 }, { cooldownMs: 86_400_001 },
    { maxConcurrent: 1001 }, { progressAfterMs: 3_600_001 }, { maxConcurrent: '1' }, { typo: 1 }])('rejects invalid policy %j', execution => {
    expect(() => defineCommand({ execution: execution as never, execute: () => 'ok' })).toThrow(TypeError);
  });
  it('copies and freezes the policy at declaration', () => {
    const execution = { maxConcurrent: 2 };
    const definition = defineCommand({ execution, execute: () => 'ok' });
    execution.maxConcurrent = 20;
    expect(definition.execution?.maxConcurrent).toBe(2);
    expect(Object.isFrozen(definition.execution)).toBe(true);
  });
  it('rejects a raw object without reading public callbacks or fields', () => {
    const fixture = setup();
    const getter = vi.fn(() => { throw new Error('untrusted'); });
    const source = Object.defineProperty({}, 'conversation', { get: getter });
    expect(fixture.admit(source)).toEqual({ reason: 'operation_unavailable' });
    expect(getter).not.toHaveBeenCalled();
  });
  it('releases only on actual finish, keeps acceptance cooldown after failures and does not extend denial', async () => {
    const f = setup(); const first = f.open();
    const policy = { maxConcurrent: 1, cooldownMs: 1000 };
    expect(f.admit(first.source, policy)).toBeUndefined();
    expect(f.admit(f.open().source, policy)).toEqual({ reason: 'busy' });
    await first.control.finish();
    f.setNow(400);
    expect(f.admit(f.open().source, policy)).toEqual({ reason: 'cooldown', retryAfterMs: 700 });
    f.setNow(1099);
    expect(f.admit(f.open().source, policy)).toEqual({ reason: 'cooldown', retryAfterMs: 1 });
    f.setNow(1100);
    const next = f.open(); expect(f.admit(next.source, policy)).toBeUndefined(); await next.control.finish();
  });
  it('never evicts running identities, but reports capacity only when every entry is running', async () => {
    const f = setup(1); const first = f.open();
    expect(f.admit(first.source, { cooldownMs: 1000 })).toBeUndefined();
    expect(f.admit(f.open('bob').source)).toEqual({ reason: 'capacity' });
    await first.control.finish();
    const next = f.open('bob'); expect(f.admit(next.source)).toBeUndefined(); await next.control.finish();
  });
  it('evicts the oldest idle cooling identity when full so new identities are not locked out', async () => {
    const f = setup(2); const policy = { cooldownMs: 100_000 };
    const [a, b] = ['a', 'b'].map(name => f.open(name));
    expect(f.admit(a.source, policy)).toBeUndefined();
    expect(f.admit(b.source, policy)).toBeUndefined();
    await a.control.finish(); await b.control.finish();
    // Table full of idle identities that are all still cooling down.
    const c = f.open('c'); expect(f.admit(c.source, policy)).toBeUndefined();
    // "b" (newer) keeps its cooldown; "a" (oldest) lost it and is no longer tracked.
    expect(f.admit(f.open('b').source, policy)).toEqual({ reason: 'cooldown', retryAfterMs: expect.any(Number) });
    await c.control.finish();
  });
  it('rejects with capacity when the only evictable identities are running', async () => {
    const f = setup(2); const a = f.open('a'), b = f.open('b');
    expect(f.admit(a.source, { cooldownMs: 1000 })).toBeUndefined();
    expect(f.admit(b.source, { cooldownMs: 1000 })).toBeUndefined();
    expect(f.admit(f.open('c').source)).toEqual({ reason: 'capacity' });
    await a.control.finish();
    const c = f.open('c'); expect(f.admit(c.source)).toBeUndefined();
    await b.control.finish(); await c.control.finish();
  });
  it('separates capabilities, adapters and accounts without weakening identical identities', async () => {
    const f = setup();
    const base = f.open(); expect(f.admit(base.source)).toBeUndefined();
    expect(f.admit(base.source, { maxConcurrent: 1 }, 'other-command')).toBeUndefined();
    for (const endpoint of [{ adapter: 'test', id: 'other-account' }, { adapter: 'other-adapter', id: 'account' }]) {
      const next = f.open('alice', { endpoint, kind: 'private', id: 'user' });
      expect(f.admit(next.source)).toBeUndefined(); await next.control.finish();
    }
    expect(f.admit(f.open().source)).toEqual({ reason: 'busy' }); await base.control.finish();
  });
  it('does not release on retirement and rejects retired admission', async () => {
    const f = setup(1); const first = f.open(); expect(f.admit(first.source)).toBeUndefined();
    f.retirement.abort();
    expect(f.admit(first.source)).toEqual({ reason: 'operation_unavailable' });
    const other = f.budget.openOperation({ snapshot: f.snapshot, conversation: { endpoint: { adapter: 'test', id: 'account' }, kind: 'private', id: 'user' },
      senderId: 'alice', retirementSignal: new AbortController().signal, reply: async () => {} });
    const source = {}; other.bind(source, f.root);
    expect(f.admit(source)).toEqual({ reason: 'busy' });
    await first.control.finish(); expect(f.admit(source)).toBeUndefined(); await other.finish();
  });
  it('requires a complete sender identity and exact operation snapshot', async () => {
    const f = setup(); const missing = f.open('');
    expect(f.admit(missing.source)).toEqual({ reason: 'identity_unavailable' });
    const actual = f.open();
    expect(f.budget.admission.admit(actual.source, 'command', f.root, { maxConcurrent: 1 }, { ...f.snapshot })).toEqual({ reason: 'operation_unavailable' });
    await missing.control.finish(); await actual.control.finish();
  });
  it('observes rejecting sends for drain while preserving the author-visible rejection', async () => {
    const f = setup(); const first = f.open(); expect(f.admit(first.source)).toBeUndefined();
    const failure = Promise.reject(new Error('delivery rejected'));
    first.control.trackSend(failure);
    await expect(failure).rejects.toThrow('delivery rejected');
    await first.control.finish();
    const next = f.open(); expect(f.admit(next.source)).toBeUndefined(); await next.control.finish();
  });
  it('keeps direct execution unchanged without policy and applies policy per command without an operation', async () => {
    const f = setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slot = (localName: string, execution: CommandExecutionPolicy | undefined, run: () => unknown) => createCapabilitySlot({ owner: f.root, feature: commandFeatureId, localName,
      source: '/command/index.ts', definition: defineCommand({ ...(execution ? { execution } : {}), execute: run as never }) });
    const index = new CommandIndex([
      slot('plain', undefined, () => 'ok'),
      slot('limited', { maxConcurrent: 1 }, () => 'limited-ok'),
      slot('slow', { maxConcurrent: 1 }, () => gate.then(() => 'slow-ok')),
      slot('cool', { cooldownMs: 1000, progressAfterMs: 50 }, () => 'cool-ok'),
      slot('boom', { maxConcurrent: 1 }, () => { throw new Error('boom'); }),
    ], f.snapshot);
    expect(await index.execute('plain')).toBe('ok');
    expect(await index.execute('limited')).toBe('limited-ok');
    expect(await index.execute('limited')).toBe('limited-ok');
    // concurrency is enforced per command and released when the execution settles
    const first = index.execute('slow');
    await expect(index.execute('slow')).rejects.toMatchObject({ limit: { reason: 'busy' } });
    release();
    expect(await first).toBe('slow-ok');
    expect(await index.execute('slow')).toBe('slow-ok');
    // a failing execution releases its slot
    await expect(index.execute('boom')).rejects.toThrow('boom');
    await expect(index.execute('boom')).rejects.toThrow('boom');
    // cooldown applies per command
    expect(await index.execute('cool')).toBe('cool-ok');
    await expect(index.execute('cool')).rejects.toMatchObject({ limit: { reason: 'cooldown', retryAfterMs: 1000 } });
    f.setNow(1100);
    expect(await index.execute('cool')).toBe('cool-ok');
  });
  it('still refuses policy-bearing dispatch without a bound operation and without the budget resource', async () => {
    const f = setup();
    const index = new CommandIndex([createCapabilitySlot({ owner: f.root, feature: commandFeatureId, localName: 'limited', source: '/command/index.ts',
      definition: defineCommand({ execution: { maxConcurrent: 1 }, execute: () => 'ok' }) })], f.snapshot);
    expect(await index.dispatch({ input: 'limited', source: {} })).toMatchObject({ matched: true, status: 'limited', limit: { reason: 'operation_unavailable' } });
    const bare = createSnapshotView(0, { ...f.snapshot, resources: new Map() } as unknown as SnapshotState);
    const bareIndex = new CommandIndex([createCapabilitySlot({ owner: f.root, feature: commandFeatureId, localName: 'limited', source: '/command/index.ts',
      definition: defineCommand({ execution: { maxConcurrent: 1 }, execute: () => 'ok' }) })], bare);
    await expect(bareIndex.execute('limited')).rejects.toMatchObject({ limit: { reason: 'service_unavailable' } });
  });
});
