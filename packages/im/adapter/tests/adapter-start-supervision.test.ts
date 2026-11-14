import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { childPluginId, createCapabilitySlot, createSnapshotView, rootPluginId,
  type CapabilityId, type PluginId, type PluginNodeSnapshot, type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import { Adapter, AdapterIndex, AdapterManagementError, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec,
  endpointEventGatewayToken, type AdapterLoginDeclaration, type Endpoint, type EndpointCreationContext,
  type EndpointDesiredRecord, type EndpointDesiredRepository, type EndpointDesiredSnapshot } from '../src/index.js';

/** What one start attempt does; `hang` resolves or rejects only when the test says so. */
type Plan = 'ok' | 'fail' | 'hang' | 'config' | 'type' | 'fetch';
interface Attempt {
  readonly endpoint: ScriptedEndpoint;
  readonly incarnationId: string;
  resolve(): void;
  reject(error: unknown): void;
}

const owners = new WeakMap<object, string>();
class ScriptedEndpoint extends EventEmitter implements Endpoint {
  readonly stop = vi.fn(async () => undefined);
  readonly open = vi.fn();
  readonly relogin = vi.fn(async () => undefined);
  readonly [endpointSpec];
  constructor(start: (signal: AbortSignal) => Promise<void>) {
    super();
    this[endpointSpec] = createEndpointSpecification(this, {
      start, open: () => this.open(), close() {}, stop: () => this.stop(), send: async () => 'message-id',
      transportState: 'open', login: { relogin: () => this.relogin() },
    });
  }
}

class ScriptedAdapter extends Adapter<ScriptedEndpoint> {
  readonly attempts: Attempt[] = [];
  readonly plans = new Map<string, Plan[]>();
  protected createEndpoint(_config: Record<string, unknown>, context: EndpointCreationContext): ScriptedEndpoint {
    const plan = this.plans.get(context.endpointId)?.shift() ?? 'ok';
    if (plan === 'config') throw new AdapterManagementError('invalid_configuration', 'missing token secret-value');
    // A programming / configuration TypeError while creating the Endpoint …
    if (plan === 'type') throw new TypeError('uin must be a number');
    // … versus undici's transport failure, also a TypeError (`fetch failed` with a socket cause).
    if (plan === 'fetch') throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) });
    let resolve!: () => void, reject!: (error: unknown) => void;
    const settled = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const endpoint = new ScriptedEndpoint(async () => {
      if (plan === 'fail') throw Object.assign(new Error('connect refused: secret-token'), { code: 'ECONNREFUSED' });
      if (plan === 'hang') await settled;
    });
    owners.set(endpoint, context.endpointId);
    this.attempts.push({ endpoint, incarnationId: context.incarnationId, resolve, reject });
    return endpoint;
  }
}

class Repository implements EndpointDesiredRepository {
  readonly state = new Map<CapabilityId, EndpointDesiredSnapshot>();
  readonly load = vi.fn(async (id: CapabilityId) => structuredClone(this.state.get(id)));
  readonly compareAndSet = vi.fn(async (id: CapabilityId, expected: number | null, endpoints: readonly EndpointDesiredRecord[], commitId?: string) => {
    if ((this.state.get(id)?.revision ?? null) !== expected) throw new AdapterManagementError('conflict', 'conflict');
    const next = structuredClone({ revision: (expected ?? 0) + 1, endpoints, commitId });
    this.state.set(id, next);
    return next;
  });
}

const GRACE = 3_000;
const disposers: Array<() => Promise<void>> = [];
const unhandled = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter: 5s, 10s, 20s …
  unhandled.mockClear();
  process.on('unhandledRejection', unhandled);
});
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose().catch(() => undefined);
  await vi.advanceTimersByTimeAsync(0);
  process.off('unhandledRejection', unhandled);
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(unhandled).not.toHaveBeenCalled();
});

async function fixture(accounts: Record<string, Plan[]>, options: { login?: AdapterLoginDeclaration } = {}) {
  const root = rootPluginId(), owner = childPluginId(root, 'one');
  const adapter = new ScriptedAdapter();
  for (const [name, plans] of Object.entries(accounts)) adapter.plans.set(name, [...plans]);
  const slot = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'scripted', source: '/fixture/adapters/scripted/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], ...(options.login ? { login: options.login } : {}), createAdapter: () => adapter }) });
  const repository = new Repository();
  repository.state.set(slot.id, { revision: 1, endpoints: Object.keys(accounts).map(name => ({
    instanceId: name, canonicalId: `${slot.id}~${name}` as CapabilityId, endpointId: name, revision: 1, desiredEnabled: true, config: {},
  })) });
  const state: SnapshotState = { root, tree: new Map<PluginId, PluginNodeSnapshot>([
    [root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [owner] }],
    [owner, { id: owner, parent: root, instanceKey: 'one', packageName: 'fixture-child', packageRoot: '/fixture/child', children: [] }],
  ]), config: new Map([[owner, {}]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  resources: new Map([[owner, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, {
    async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); },
    receive: async () => undefined }]])]]) };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal, { repository, startGraceMs: GRACE });
  disposers.push(() => index.stop());
  const id = (name: string) => `${slot.id}~${name}` as CapabilityId;
  const row = (name: string) => index.describe().find(entry => entry.id === id(name));
  const activate = async () => {
    const activation = index.activate(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(GRACE);
    await activation;
  };
  return { adapter, index, repository, id, row, activate };
}

/** Attempts of one account, in creation order. */
function attemptsOf(adapter: ScriptedAdapter, name: string): Attempt[] {
  return adapter.attempts.filter(attempt => owners.get(attempt.endpoint) === name);
}

describe('Adapter background start supervision', () => {
  it('returns from activation within the grace period while a start never resolves, then opens it late', async () => {
    const { adapter, index, id, row, activate } = await fixture({ slow: ['hang'] });
    await activate();
    expect(row('slow')).toMatchObject({ phase: 'starting', connected: false, startAttempt: 1 });
    expect(() => index.acquire(id('slow'))).toThrow(expect.objectContaining({ code: 'endpoint_inactive' }));
    const lease = index.acquireLogin(id('slow'));
    lease.release();
    attemptsOf(adapter, 'slow')[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(row('slow')).toMatchObject({ phase: 'online', connected: true, startAttempt: 0 });
    expect(row('slow')?.startFailure).toBeUndefined();
    expect(attemptsOf(adapter, 'slow')[0]!.endpoint.open).toHaveBeenCalledOnce();
  });

  it('keeps one account online while another fails, retries with backoff and a new incarnation', async () => {
    const { adapter, row, activate } = await fixture({ good: ['ok'], bad: ['fail', 'fail', 'ok'] });
    const started = Date.now();
    await activate();
    expect(row('good')).toMatchObject({ phase: 'online' });
    expect(row('bad')).toMatchObject({ phase: 'retrying', startAttempt: 1,
      startFailure: { code: 'ECONNREFUSED' }, nextRetryAt: expect.any(Number) });
    expect(JSON.stringify(row('bad'))).not.toContain('secret-token');
    const firstRetryAt = row('bad')!.nextRetryAt!;
    expect(firstRetryAt - row('bad')!.startFailure!.at).toBe(5_000);
    expect(attemptsOf(adapter, 'bad')).toHaveLength(1);
    expect(attemptsOf(adapter, 'bad')[0]!.endpoint.stop).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(firstRetryAt - Date.now());
    expect(attemptsOf(adapter, 'bad')).toHaveLength(2);
    expect(row('bad')).toMatchObject({ phase: 'retrying', startAttempt: 2 });
    expect(row('bad')!.nextRetryAt! - row('bad')!.startFailure!.at).toBe(10_000);

    await vi.advanceTimersByTimeAsync(10_000);
    const attempts = attemptsOf(adapter, 'bad');
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts.map(attempt => attempt.incarnationId)).size).toBe(3);
    expect(row('bad')).toMatchObject({ phase: 'online', startAttempt: 0 });
    expect(row('bad')?.startFailure).toBeUndefined();
    expect(row('bad')?.nextRetryAt).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(15_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps the backoff at five minutes and keeps retrying', async () => {
    const plans: Plan[] = Array.from({ length: 9 }, () => 'fail' as const);
    const { row, activate } = await fixture({ bad: plans });
    await activate();
    for (let attempt = 1; attempt < 9; attempt += 1) await vi.advanceTimersByTimeAsync(row('bad')!.nextRetryAt! - Date.now());
    expect(row('bad')).toMatchObject({ phase: 'retrying', startAttempt: 9 });
    expect(row('bad')!.nextRetryAt! - row('bad')!.startFailure!.at).toBe(300_000);
  });

  it('dispose during a start stops it exactly once and leaves no loop, timer or retiring epoch', async () => {
    const { adapter, index, activate } = await fixture({ slow: ['hang'] });
    await activate();
    const [attempt] = attemptsOf(adapter, 'slow');
    await index.stop();
    expect(attempt!.endpoint.stop).toHaveBeenCalledOnce();
    attempt!.resolve();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(adapter.attempts).toHaveLength(1);
    expect(attempt!.endpoint.open).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(adapter.runtimeStatus().some(entry => entry.retiring)).toBe(false);
  });

  it('dispose during a retry wait cancels the retry and its timer', async () => {
    const { adapter, index, activate } = await fixture({ bad: ['fail', 'ok'] });
    await activate();
    expect(vi.getTimerCount()).toBe(1);
    await index.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(adapter.attempts).toHaveLength(1);
    expect(adapter.attempts[0]!.endpoint.stop).toHaveBeenCalledOnce();
  });

  it('stop cancels a waiting retry, a later start begins a fresh supervision', async () => {
    const { adapter, row, activate } = await fixture({ bad: ['fail', 'ok'] });
    await activate();
    await adapter.stop('bad', adapter.revision);
    expect(row('bad')).toMatchObject({ phase: 'offline', startAttempt: 0 });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(attemptsOf(adapter, 'bad')).toHaveLength(1);
    const started = await adapter.start('bad', adapter.revision);
    expect(started.execution).toEqual({ status: 'applied' });
    expect(attemptsOf(adapter, 'bad')).toHaveLength(2);
    expect(row('bad')).toMatchObject({ phase: 'online' });
  });

  it('a retry racing a stop commit never resurrects the stopped account', async () => {
    const { adapter, repository, row, activate } = await fixture({ bad: ['fail', 'hang', 'ok', 'ok'] });
    await activate();
    // Hold the stop CAS while the retry timer fires: the retry still sees the account enabled.
    const persist = repository.compareAndSet.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    repository.compareAndSet.mockImplementationOnce(async (...args) => { await held; return persist(...args); });
    const stopping = adapter.stop('bad', adapter.revision);
    await vi.advanceTimersByTimeAsync(5_000);
    const [, retry] = attemptsOf(adapter, 'bad');
    expect(retry).toBeDefined();
    release();
    await stopping;
    expect(retry!.endpoint.stop).toHaveBeenCalledOnce();
    // The retired attempt resolving late neither opens nor schedules anything.
    retry!.resolve();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(retry!.endpoint.open).not.toHaveBeenCalled();
    expect(attemptsOf(adapter, 'bad')).toHaveLength(2);
    expect(row('bad')).toMatchObject({ phase: 'offline', startAttempt: 0 });
    expect(row('bad')?.startFailure).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('update during a start retires the old attempt; its late resolution never opens it', async () => {
    const { adapter, row, activate } = await fixture({ slow: ['hang', 'ok'] });
    await activate();
    const [old] = attemptsOf(adapter, 'slow');
    const updated = await adapter.update('slow', adapter.revision, { config: { token: 'next' } });
    expect(updated.execution).toEqual({ status: 'applied' });
    expect(old!.endpoint.stop).toHaveBeenCalledOnce();
    old!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(old!.endpoint.open).not.toHaveBeenCalled();
    expect(attemptsOf(adapter, 'slow')).toHaveLength(2);
    expect(attemptsOf(adapter, 'slow')[1]!.endpoint.open).toHaveBeenCalledOnce();
    expect(row('slow')).toMatchObject({ phase: 'online' });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(attemptsOf(adapter, 'slow')).toHaveLength(2);
  });

  it('reports the first failed attempt of a start mutation and keeps retrying in the background', async () => {
    const { adapter, row, activate } = await fixture({ bad: ['ok', 'fail', 'ok'] });
    await activate();
    await adapter.stop('bad', adapter.revision);
    const result = await adapter.start('bad', adapter.revision);
    expect(result.execution).toEqual({ status: 'failed', code: 'endpoint_start_failed' });
    expect(row('bad')).toMatchObject({ phase: 'retrying', startAttempt: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(row('bad')).toMatchObject({ phase: 'online' });
  });

  it('does not retry configuration errors', async () => {
    const { adapter, row, activate } = await fixture({ bad: ['config', 'ok'] });
    await activate();
    expect(row('bad')).toMatchObject({ phase: 'failed', startFailure: { code: 'invalid_configuration' } });
    expect(row('bad')?.nextRetryAt).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(adapter.plans.get('bad')).toEqual(['ok']);
  });

  it('does not retry a TypeError while creating the Endpoint, but retries undici fetch failures', async () => {
    const { adapter, row, activate } = await fixture({ typed: ['type', 'ok'], net: ['fetch', 'ok'] });
    await activate();
    expect(row('typed')).toMatchObject({ phase: 'failed', startFailure: { category: 'config' } });
    expect(row('typed')?.nextRetryAt).toBeUndefined();
    expect(row('net')).toMatchObject({ phase: 'retrying', startFailure: { category: 'network' }, nextRetryAt: expect.any(Number) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(row('net')).toMatchObject({ phase: 'online' });
    expect(adapter.plans.get('typed')).toEqual(['ok']);
  });

  it('never auto-retries an interactive login; Console relogin retries it at once', async () => {
    const { adapter, index, id, row, activate } = await fixture({ qq: ['fail', 'ok'] },
      { login: { mode: 'interactive', relogin: true } });
    await activate();
    expect(row('qq')).toMatchObject({ phase: 'failed', startFailure: { code: 'ECONNREFUSED' } });
    expect(row('qq')?.nextRetryAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(attemptsOf(adapter, 'qq')).toHaveLength(1);
    const control = index.loginControl(id('qq'));
    await control!.relogin!({});
    await vi.advanceTimersByTimeAsync(0);
    expect(attemptsOf(adapter, 'qq')).toHaveLength(2);
    expect(attemptsOf(adapter, 'qq')[0]!.endpoint.relogin).not.toHaveBeenCalled();
    expect(row('qq')).toMatchObject({ phase: 'online' });
  });

  it('relogin wakes a waiting retry early', async () => {
    const { adapter, index, id, row, activate } = await fixture({ bad: ['fail', 'ok'] });
    await activate();
    expect(row('bad')).toMatchObject({ phase: 'retrying' });
    await index.loginControl(id('bad'))!.relogin!({});
    await vi.advanceTimersByTimeAsync(0);
    expect(attemptsOf(adapter, 'bad')).toHaveLength(2);
    expect(row('bad')).toMatchObject({ phase: 'online' });
    expect(vi.getTimerCount()).toBe(0);
    expect(adapter.retryStart('bad')).toBe(false);
  });
});
