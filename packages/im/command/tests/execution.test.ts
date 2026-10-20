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
  it('does not evict active or cooling identities to make capacity', async () => {
    const f = setup(1); const first = f.open();
    expect(f.admit(first.source, { cooldownMs: 1000 })).toBeUndefined();
    expect(f.admit(f.open('bob').source)).toEqual({ reason: 'capacity' });
    await first.control.finish();
    expect(f.admit(f.open('bob').source)).toEqual({ reason: 'capacity' });
    f.setNow(1100);
    const next = f.open('bob'); expect(f.admit(next.source)).toBeUndefined(); await next.control.finish();
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
  it('keeps direct execution unchanged without policy and explicitly rejects policy without an operation', async () => {
    const f = setup();
    const slots = [false, true].map(enabled => createCapabilitySlot({ owner: f.root, feature: commandFeatureId, localName: enabled ? 'limited' : 'plain', source: '/command/index.ts',
      definition: defineCommand({ ...(enabled ? { execution: { maxConcurrent: 1 } } : {}), execute: () => 'ok' }) }));
    const index = new CommandIndex(slots, f.snapshot);
    expect(await index.execute('plain')).toBe('ok');
    await expect(index.execute('limited')).rejects.toBeInstanceOf(CommandExecutionLimitedError);
    expect(await index.dispatch('limited', {})).toMatchObject({ matched: true, status: 'limited', limit: { reason: 'operation_unavailable' } });
  });
});
