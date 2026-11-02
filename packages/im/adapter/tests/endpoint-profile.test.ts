import { EventEmitter } from 'node:events';
import {
  Adapter, createEndpointSpecification, defineAdapter, endpointSpec,
  type Endpoint, type EndpointProfile, type SelfProfile, type SelfProfileField,
  type SelfProfileReadRequest, type SelfProfileWriteRequest, type SelfProfileWriteResult,
} from '../src/index.js';
import { EndpointProfileState, configuredSelfProfile, mergeEndpointProfileConfiguration } from '../src/endpoint-profile.js';
import { createAdapterHarness } from '../../../../plugins/adapters/test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../../../plugins/adapters/test-utils/desired-repository.js';
import { accountRuntimeFixture } from './account-runtime-fixture.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const signal = () => new AbortController().signal;

class NativeProfile implements EndpointProfile {
  readonly #nickname = 'Native';
  readonly writableFields: readonly SelfProfileField[] = ['nickname', 'signature'];
  readonly current = Object.freeze({ nickname: 'Login cache' });
  readonly reads: AbortSignal[] = [];
  readonly writes: SelfProfileWriteRequest[] = [];
  failRead = false;
  pending?: Promise<SelfProfile>;
  async read(request: SelfProfileReadRequest): Promise<SelfProfile> {
    this.reads.push(request.signal);
    if (this.failRead) throw new Error('native profile lookup failed');
    return this.pending ?? { nickname: this.#nickname, gender: null, signature: '', interests: [] };
  }
  async write(request: SelfProfileWriteRequest): Promise<SelfProfileWriteResult> {
    this.writes.push(request);
    return { status: 'updated' };
  }
}

describe('account-owned profile facts and configuration fallback', () => {
  it.each(['caller cancellation', 'account change'])('preserves a write ACK observed before %s', async reason => {
    const pending = deferred<SelfProfileWriteResult>();
    const write = vi.fn(() => pending.promise);
    const source: EndpointProfile = { writableFields: ['nickname'], read: async () => ({}), write };
    const state = new EndpointProfileState({ source, defaults: { nickname: 'Configured' } });
    const caller = new AbortController();
    const updating = state.write({ signal: caller.signal, change: { field: 'nickname', value: 'Confirmed' } });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    let next: EndpointProfileState | undefined;
    pending.resolve({ status: 'updated', profile: { nickname: 'Confirmed' } });
    // The operation consumes its ACK before this microtask; the caller's await
    // continuation runs afterward and must not replace that ACK with not_sent.
    queueMicrotask(() => {
      if (reason === 'account change') next = state.nextAccount();
      else caller.abort(new Error('caller ended'));
    });
    await expect(updating).resolves.toMatchObject({ status: 'updated', profile: { nickname: 'Confirmed' } });
    if (next) expect(next.peek().values.nickname).toBe('Configured');
    else expect(state.peek().values.nickname).toBe('Confirmed');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('ends old captured profile ports when the source account changes, retaining only configured fallbacks', async () => {
    const source = new NativeProfile();
    const state = new EndpointProfileState({ source, defaults: { nickname: 'Configured' } });
    await state.read({ signal: signal() });
    const next = state.nextAccount();
    expect(() => state.peek()).toThrow('Profile account changed');
    await expect(state.read({ signal: signal() })).rejects.toMatchObject({ disposition: 'not_sent' });
    await expect(state.write({ signal: signal(), change: { field: 'nickname', value: 'Wrong account' } }))
      .rejects.toMatchObject({ disposition: 'not_sent' });
    expect(source.writes).toHaveLength(0);
    expect(next.peek().values).toEqual({ nickname: 'Configured' });
    expect((await next.read({ signal: signal() })).values.nickname).toBe('Native');
  });

  it('does not let an old account read settle into its replacement profile', async () => {
    const pending = deferred<SelfProfile>();
    const source = new NativeProfile(); source.pending = pending.promise;
    const state = new EndpointProfileState({ source, defaults: {} });
    const reading = state.read({ signal: signal() });
    const rejected = expect(reading).rejects.toMatchObject({ disposition: 'not_sent' });
    const next = state.nextAccount();
    await rejected;
    pending.resolve({ nickname: 'Late old account' });
    await Promise.resolve();
    expect(next.peek().values).toEqual({});
  });

  it('keeps a submitted old-account write unknown and a queued write unsubmitted after an account change', async () => {
    const pending = deferred<SelfProfileWriteResult>();
    const write = vi.fn(() => pending.promise);
    const state = new EndpointProfileState({ defaults: {}, source: {
      writableFields: ['nickname'], read: async () => ({}), write,
    } });
    const first = state.write({ signal: signal(), change: { field: 'nickname', value: 'First' } });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const second = state.write({ signal: signal(), change: { field: 'nickname', value: 'Queued' } });
    const firstRejected = expect(first).rejects.toMatchObject({ disposition: 'unknown' });
    const secondRejected = expect(second).rejects.toMatchObject({ disposition: 'not_sent' });
    const next = state.nextAccount();
    await Promise.all([firstRejected, secondRejected]);
    pending.resolve({ status: 'updated', profile: { nickname: 'Late old name' } });
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(next.peek().values).toEqual({});
  });

  it.each(['2024-02-30', '2023-02-29', '2024-13-01', 'not-a-date'])('rejects impossible configured birthdays: %s', birthday => {
    expect(() => configuredSelfProfile({ profile: { birthday } })).toThrow('calendar date');
  });

  it.each(['2000-02-29', '2024-02-29', '2024-12-31'])('retains an explicit valid configured birthday: %s', birthday => {
    expect(configuredSelfProfile({ profile: { birthday } })).toEqual({ birthday });
  });

  it('merges Endpoint profile defaults per field without changing unrelated nested configuration', () => {
    const config = mergeEndpointProfileConfiguration(
      { nickname: 'Adapter', profile: { gender: 'female', interests: ['music'] }, transport: { one: 1 } },
      { nickname: 'Endpoint', profile: { gender: 'male' }, transport: { two: 2 } },
    );
    expect(configuredSelfProfile(config)).toEqual({ nickname: 'Endpoint', gender: 'male', interests: ['music'] });
    expect(config.transport).toEqual({ two: 2 });
  });

  it('keeps null, empty strings, zero and empty arrays as known platform facts', async () => {
    const native = new NativeProfile();
    native.pending = Promise.resolve({ nickname: '', gender: null, age: 0, signature: '', interests: [] });
    const state = new EndpointProfileState({ source: native, defaults: {
      nickname: 'Configured', gender: 'female', age: 18, signature: 'fallback', interests: ['music'], bio: 'Fallback bio',
    } });
    expect(await state.read({ signal: signal() })).toMatchObject({
      values: { nickname: '', gender: null, age: 0, signature: '', interests: [], bio: 'Fallback bio' },
      sources: { nickname: 'platform', gender: 'platform', age: 'platform', signature: 'platform', interests: 'platform', bio: 'configured' },
      platformStatus: 'available',
    });
  });

  it('does not claim configured-only fields can be written to an unsupported account', async () => {
    const state = new EndpointProfileState({ defaults: { nickname: 'Configured', age: 18, interests: ['music'] } });
    expect(await state.read({ signal: signal() })).toEqual({
      values: { nickname: 'Configured', age: 18, interests: ['music'] },
      sources: { nickname: 'configured', age: 'configured', interests: 'configured' },
      writableFields: [], platformStatus: 'unsupported',
    });
    expect(state.write).toBeUndefined();
  });

  it('copies only public facts and freezes their array values', async () => {
    const interests = ['music'];
    const source: EndpointProfile = { writableFields: [], read: async () => ({ interests, mail: 'private@example.test' }) };
    const snapshot = await new EndpointProfileState({ source, defaults: {} }).read({ signal: signal() });
    interests.push('changed');
    expect(snapshot.values).toEqual({ interests: ['music'] });
    expect(Object.isFrozen(snapshot.values.interests)).toBe(true);
    expect(Object.isFrozen(snapshot.sources)).toBe(true);
  });

  it('uses the same account snapshot until explicit refresh and keeps refresh errors meaningful', async () => {
    const source = new NativeProfile(), state = new EndpointProfileState({ source, defaults: {} });
    await state.read({ signal: signal() });
    await state.read({ signal: signal() });
    expect(source.reads).toHaveLength(1);
    source.failRead = true;
    await expect(state.read({ signal: signal(), refresh: true })).rejects.toThrow('native profile lookup failed');
    expect(state.peek().values.nickname).toBe('Native');
    expect(state.peek().platformStatus).toBe('available');
  });

  it('retains a confirmed rename when the SDK login cache and later failed refresh are stale', async () => {
    const source = new NativeProfile(), state = new EndpointProfileState({ source, defaults: {} });
    await state.read({ signal: signal() });
    await state.write({ signal: signal(), change: { field: 'nickname', value: 'Renamed' } });
    source.failRead = true;
    await expect(state.read({ signal: signal(), refresh: true })).rejects.toThrow('native profile lookup failed');
    expect(state.peek().values.nickname).toBe('Renamed');
    expect(source.current.nickname).toBe('Login cache');
  });

  it('uses changed native facts after a read without repeating a platform query', async () => {
    let current: SelfProfile = { nickname: 'Initial', interests: ['music'] };
    const read = vi.fn(async () => current);
    const state = new EndpointProfileState({ defaults: {}, source: {
      get current() { return current; }, writableFields: [], read,
    } });
    await state.read({ signal: signal() });
    current = { nickname: 'Native update', interests: ['books'] };
    expect(state.peek().values).toEqual(current);
    expect((await state.read({ signal: signal() })).values).toEqual(current);
    expect(read).toHaveBeenCalledOnce();
  });

  it('does not let an unchanged login cache undo a write but accepts a later native change', async () => {
    let current: SelfProfile = { nickname: 'Initial' };
    const state = new EndpointProfileState({ defaults: {}, source: {
      get current() { return current; }, writableFields: ['nickname'],
      read: async () => current, write: async () => ({ status: 'updated' }),
    } });
    await state.read({ signal: signal() });
    await state.write({ signal: signal(), change: { field: 'nickname', value: 'Written' } });
    expect(state.peek().values.nickname).toBe('Written');
    current = { nickname: 'Changed externally' };
    expect(state.peek().values.nickname).toBe('Changed externally');
  });

  it('preserves confirmed fields omitted by a partial read until a platform clear is explicit', async () => {
    let profile: SelfProfile = { nickname: 'Account' };
    const state = new EndpointProfileState({ defaults: { bio: 'Configured old bio' }, source: {
      writableFields: ['bio'], read: async () => profile, write: async () => ({ status: 'updated' }),
    } });
    await state.read({ signal: signal() });
    await state.write({ signal: signal(), change: { field: 'bio', value: 'Confirmed new bio' } });
    expect((await state.read({ signal: signal(), refresh: true })).values.bio).toBe('Confirmed new bio');
    profile = { nickname: 'Account', bio: null };
    expect((await state.read({ signal: signal(), refresh: true })).values.bio).toBeNull();
    profile = { nickname: 'Account', bio: '' };
    expect((await state.read({ signal: signal(), refresh: true })).values.bio).toBe('');
  });

  it('accepts newer native evidence after an unknown effect without resurrecting unchanged stale data', async () => {
    let current: SelfProfile = { nickname: 'Before' };
    const state = new EndpointProfileState({ defaults: {}, source: {
      get current() { return current; }, writableFields: ['nickname'],
      read: async () => current, write: async () => ({ status: 'unknown' }),
    } });
    await state.read({ signal: signal() });
    await state.write({ signal: signal(), change: { field: 'nickname', value: 'Requested' } });
    expect(state.peek().values.nickname).toBeUndefined();
    current = { nickname: 'Platform observed' };
    expect(state.peek().values.nickname).toBe('Platform observed');
  });

  it('keeps a native event observed during a pending remote read even when the response is older', async () => {
    let current: SelfProfile = { nickname: 'Before' };
    const pending = deferred<SelfProfile>();
    const state = new EndpointProfileState({ defaults: {}, source: {
      get current() { return current; }, writableFields: [], read: () => pending.promise,
    } });
    const read = state.read({ signal: signal() });
    current = { nickname: 'Changed during read' };
    expect(state.peek().values.nickname).toBe('Changed during read');
    pending.resolve({ nickname: 'Before' });
    expect((await read).values.nickname).toBe('Changed during read');
  });

  it('retains a native update observed by another reader while a write is pending', async () => {
    let current: SelfProfile = { nickname: 'Before' };
    const pending = deferred<SelfProfileWriteResult>();
    const submitted = deferred<void>();
    const state = new EndpointProfileState({ defaults: {}, source: {
      get current() { return current; }, writableFields: ['nickname'],
      read: async () => current, write: () => { submitted.resolve(); return pending.promise; },
    } });
    await state.read({ signal: signal() });
    const write = state.write({ signal: signal(), change: { field: 'nickname', value: 'Requested' } });
    await submitted.promise;
    current = { nickname: 'Observed while pending' };
    expect(state.peek().values.nickname).toBe('Observed while pending');
    pending.resolve({ status: 'updated' });
    await write;
    expect(state.peek().values.nickname).toBe('Observed while pending');
  });

  it('does not let an older read overwrite a confirmed write', async () => {
    const pending = deferred<SelfProfile>(), source = new NativeProfile();
    source.pending = pending.promise;
    const state = new EndpointProfileState({ source, defaults: {} });
    const read = state.read({ signal: signal() });
    await state.write({ signal: signal(), change: { field: 'nickname', value: 'Renamed' } });
    pending.resolve({ nickname: 'Old' });
    expect((await read).values.nickname).toBe('Renamed');
  });

  it('does not let an earlier concurrent read replace a newer completed refresh', async () => {
    const pending = deferred<SelfProfile>(), source = new NativeProfile();
    source.pending = pending.promise;
    const state = new EndpointProfileState({ source, defaults: {} });
    const earlier = state.read({ signal: signal() });
    source.pending = Promise.resolve({ nickname: 'Fresh' });
    await state.read({ signal: signal(), refresh: true });
    pending.resolve({ nickname: 'Old' });
    expect((await earlier).values.nickname).toBe('Fresh');
  });

  it('does not cache a late result after its caller aborts or poison another caller', async () => {
    const pending = deferred<SelfProfile>(), source = new NativeProfile();
    source.pending = pending.promise;
    const state = new EndpointProfileState({ source, defaults: {} });
    const cancelled = new AbortController();
    const read = state.read({ signal: cancelled.signal });
    const rejected = expect(read).rejects.toMatchObject({ code: 'endpoint_inactive' });
    cancelled.abort(new Error('caller stopped'));
    source.pending = Promise.resolve({ nickname: 'Other caller' });
    await state.read({ signal: signal() });
    pending.resolve({ nickname: 'Cancelled result' });
    await rejected;
    expect(state.peek().values.nickname).toBe('Other caller');
  });

  it('does not submit unsupported age/birthday updates or invent a birthday', async () => {
    const source = new NativeProfile(), state = new EndpointProfileState({ source, defaults: { age: 18 } });
    expect(await state.write({ signal: signal(), change: { field: 'age', value: 20 } })).toMatchObject({ status: 'rejected' });
    expect(await state.write({ signal: signal(), change: { field: 'birthday', value: '2000-01-01' } })).toMatchObject({ status: 'rejected' });
    expect(source.writes).toEqual([]);
    expect(state.peek().values.birthday).toBeUndefined();
  });

  it('invalidates only the affected field after an unknown effect and never retries a write', async () => {
    const write = vi.fn(async () => ({ status: 'unknown' as const }));
    const state = new EndpointProfileState({ defaults: {}, source: {
      current: { nickname: 'Old cache' }, writableFields: ['nickname'],
      read: async () => ({ nickname: 'Old', bio: 'Unchanged' }), write,
    } });
    await state.read({ signal: signal() });
    expect(await state.write({ signal: signal(), change: { field: 'nickname', value: 'New' } })).toEqual({ status: 'unknown' });
    expect(state.peek().values).toEqual({ bio: 'Unchanged' });
    expect(write).toHaveBeenCalledOnce();
  });

  it('rejects inline/path avatars at the shared returned-facts boundary', async () => {
    for (const avatar of ['data:image/png;base64,AAAA', 'base64://AAAA', '/private/image.png', 'file:///private/image.png']) {
      expect(() => configuredSelfProfile({ profile: { avatar } })).toThrow('HTTP(S) URL');
      const state = new EndpointProfileState({ defaults: {}, source: {
        writableFields: [], read: async () => ({ avatar }),
      } });
      await expect(state.read({ signal: signal() })).rejects.toThrow('HTTP(S) URL');
    }
  });

  it('does not describe an uploaded source URL as the platform avatar after a successful write', async () => {
    const state = new EndpointProfileState({ defaults: {}, source: {
      current: { avatar: 'https://platform.test/old.png' }, writableFields: ['avatar'],
      read: async () => ({ avatar: 'https://platform.test/current.png' }),
      write: async () => ({ status: 'updated' }),
    } });
    await state.write({ signal: signal(), change: { field: 'avatar', value: { kind: 'url', value: 'https://asset.test/upload.png' } } });
    expect(state.peek().values.avatar).toBeUndefined();
    expect((await state.read({ signal: signal() })).values.avatar).toBe('https://platform.test/current.png');
  });

  it('invalidates stale evidence when a submitted write is cancelled, without retrying', async () => {
    const pending = deferred<SelfProfileWriteResult>(), submitted = deferred<void>();
    const write = vi.fn(() => { submitted.resolve(); return pending.promise; });
    const state = new EndpointProfileState({ defaults: {}, source: {
      current: { nickname: 'Cached' }, writableFields: ['nickname'], read: async () => ({ nickname: 'Before' }), write,
    } });
    await state.read({ signal: signal() });
    const caller = new AbortController();
    const updating = state.write({ signal: caller.signal, change: { field: 'nickname', value: 'After' } });
    await submitted.promise;
    const rejected = expect(updating).rejects.toMatchObject({ code: 'endpoint_inactive', disposition: 'unknown' });
    caller.abort();
    await rejected;
    expect(state.peek().values.nickname).toBeUndefined();
    pending.resolve({ status: 'updated' });
    await Promise.resolve();
    expect(state.peek().values.nickname).toBeUndefined();
    expect(write).toHaveBeenCalledOnce();
  });

  it('does not apply unrelated fields from a full native mutation response', async () => {
    const write = vi.fn(async ({ change }: SelfProfileWriteRequest): Promise<SelfProfileWriteResult> => change.field === 'nickname'
      ? { status: 'updated', profile: { nickname: 'New name', signature: 'Stale signature' } }
      : { status: 'updated', profile: { nickname: 'Stale name', signature: 'New signature' } });
    const state = new EndpointProfileState({ defaults: {}, source: {
      writableFields: ['nickname', 'signature'], read: async () => ({ nickname: 'Old name', signature: 'Old signature' }), write,
    } });
    await state.read({ signal: signal() });
    const renamed = await state.write({ signal: signal(), change: { field: 'nickname', value: 'New name' } });
    expect(renamed).toEqual({ status: 'updated', profile: { nickname: 'New name' } });
    expect(state.peek().values.signature).toBe('Old signature');
    const signature = await state.write({ signal: signal(), change: { field: 'signature', value: 'New signature' } });
    expect(signature).toEqual({ status: 'updated', profile: { signature: 'New signature' } });
    expect(state.peek().values).toEqual({ nickname: 'New name', signature: 'New signature' });
  });

  it('serializes concurrent same-account writes in submission order before starting their effects', async () => {
    const firstResult = deferred<SelfProfileWriteResult>(), secondResult = deferred<SelfProfileWriteResult>();
    const firstStarted = deferred<void>(), secondStarted = deferred<void>();
    const write = vi.fn(({ change }: SelfProfileWriteRequest) => {
      if (change.value === 'First') { firstStarted.resolve(); return firstResult.promise; }
      secondStarted.resolve(); return secondResult.promise;
    });
    const state = new EndpointProfileState({ defaults: {}, source: {
      writableFields: ['nickname'], read: async () => ({}), write,
    } });
    const first = state.write({ signal: signal(), change: { field: 'nickname', value: 'First' } });
    const second = state.write({ signal: signal(), change: { field: 'nickname', value: 'Second' } });
    await firstStarted.promise;
    expect(write).toHaveBeenCalledTimes(1);
    firstResult.resolve({ status: 'updated', profile: { nickname: 'First', signature: 'Unrelated stale value' } });
    await secondStarted.promise;
    expect(write).toHaveBeenCalledTimes(2);
    secondResult.resolve({ status: 'updated', profile: { nickname: 'Second' } });
    await Promise.all([first, second]);
    expect(state.peek().values).toEqual({ nickname: 'Second' });
  });

  it('cancels a queued write as not submitted and leaves later calls behind the active predecessor', async () => {
    const firstResult = deferred<SelfProfileWriteResult>(), firstStarted = deferred<void>(), thirdStarted = deferred<void>();
    const write = vi.fn(({ change }: SelfProfileWriteRequest): Promise<SelfProfileWriteResult> => {
      if (change.value === 'First') { firstStarted.resolve(); return firstResult.promise; }
      thirdStarted.resolve(); return Promise.resolve({ status: 'updated' });
    });
    const state = new EndpointProfileState({ defaults: {}, source: { writableFields: ['nickname'], read: async () => ({}), write } });
    const first = state.write({ signal: signal(), change: { field: 'nickname', value: 'First' } });
    await firstStarted.promise;
    const abort = new AbortController();
    const second = state.write({ signal: abort.signal, change: { field: 'nickname', value: 'Never submitted' } });
    const rejected = expect(second).rejects.toMatchObject({ disposition: 'not_sent' });
    const third = state.write({ signal: signal(), change: { field: 'nickname', value: 'Third' } });
    abort.abort(); await rejected;
    expect(write).toHaveBeenCalledTimes(1);
    firstResult.resolve({ status: 'updated' });
    await thirdStarted.promise;
    await Promise.all([first, third]);
    expect(write.mock.calls.map(([request]) => request.change.value)).toEqual(['First', 'Third']);
    expect(state.peek().values.nickname).toBe('Third');
  });
});

async function fixture(config: Readonly<Record<string, unknown>> = { id: 'native' }, options: {
  readonly repository?: MemoryDesiredRepository;
  readonly native?: boolean;
} = {}) {
  const profiles: NativeProfile[] = [];
  const constructed: Array<Readonly<Record<string, unknown>>> = [];
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly profile = new NativeProfile();
    readonly [endpointSpec] = createEndpointSpecification(this, {
      start() {}, open() {}, close() {}, stop() {}, ...(options.native !== false ? { profile: this.profile } : {}),
    });
  }
  class NativeAdapter extends Adapter<NativeEndpoint> {
    protected createEndpoint(config: Readonly<Record<string, unknown>>) {
      constructed.push(structuredClone(config));
      const endpoint = new NativeEndpoint(); profiles.push(endpoint.profile); return endpoint;
    }
  }
  const adapter = new NativeAdapter();
  const repository = options.repository ?? new MemoryDesiredRepository();
  if (!options.repository) repository.snapshot = undefined;
  const harness = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: () => adapter }), config, { repository });
  await harness.start(); harness.open();
  return { ...harness, account: adapter, profiles, constructed, repository };
}

describe('profile port through the owning Adapter/Index', () => {
  it('binds current Host profile defaults to restored accounts without changing transport snapshots or saving rows', async () => {
    const connection = { id: 'native', transport: { source: 'stored connection' } };
    const original = await fixture(connection, { native: false });
    const account = original.account.list()[0]!;
    await original.stop();
    const repository = new MemoryDesiredRepository();
    repository.snapshot = { revision: 7, endpoints: [{
      instanceId: account.instanceId, canonicalId: account.canonicalId, endpointId: account.endpointId,
      revision: 3, desiredEnabled: true, config: connection,
    }] };
    const before = structuredClone(repository.snapshot);
    const defaults = { id: 'native', transport: { source: 'new startup value must not replace stored connection' },
      nickname: 'Current Host name', profile: { bio: 'Host bio', interests: ['music'] } };
    const restored = await fixture(defaults, { repository, native: false });
    try {
      expect(restored.constructed).toEqual([connection]);
      expect(restored.index.profile(account.canonicalId)!.peek().values)
        .toEqual({ nickname: 'Current Host name', bio: 'Host bio', interests: ['music'] });
      await restored.index.profile(account.canonicalId)!.read({ signal: signal() });
      expect(repository.writes).toEqual([]);
      expect(repository.snapshot).toEqual(before);
    } finally { await restored.stop(); }

    const next = await fixture({ ...defaults, nickname: 'Changed Host name', profile: { bio: 'Changed Host bio', interests: ['books'] } },
      { repository, native: false });
    try {
      expect(next.constructed).toEqual([connection]);
      expect(next.index.profile(account.canonicalId)!.peek().values)
        .toEqual({ nickname: 'Changed Host name', bio: 'Changed Host bio', interests: ['books'] });
      expect(repository.writes).toEqual([]);
      expect(repository.snapshot).toEqual(before);
    } finally { await next.stop(); }
  });

  it('preserves explicit per-account null and empty overrides when restored against new Host defaults', async () => {
    const initial = await fixture({ id: 'native' }, { native: false });
    const account = initial.account.list()[0]!;
    await initial.stop();
    const repository = new MemoryDesiredRepository();
    const connection = { id: 'native', transport: { source: 'stored' }, nickname: null,
      profile: { gender: null, signature: '', interests: [] } };
    repository.snapshot = { revision: 4, endpoints: [{
      instanceId: account.instanceId, canonicalId: account.canonicalId, endpointId: account.endpointId,
      revision: 2, desiredEnabled: true, config: connection,
    }] };
    const restored = await fixture({ id: 'native', nickname: 'Host name', profile: {
      gender: 'female', signature: 'Host signature', interests: ['music'], bio: 'Inherited bio', age: 18,
    } }, { repository, native: false });
    try {
      expect(restored.index.profile(account.canonicalId)!.peek()).toMatchObject({
        values: { nickname: null, gender: null, signature: '', interests: [], bio: 'Inherited bio', age: 18 },
        sources: { nickname: 'configured', gender: 'configured', bio: 'configured' },
      });
      expect(restored.constructed).toEqual([connection]);
      expect(repository.writes).toEqual([]);
    } finally { await restored.stop(); }
  });

  it('does not copy Adapter profile defaults into new initial account records', async () => {
    const h = await fixture({ nickname: 'Adapter', profile: { bio: 'Adapter bio', interests: ['music'] },
      transport: { source: 'connection default' }, endpoints: [{ id: 'one', nickname: 'Endpoint', profile: { age: 18 } }] }, { native: false });
    try {
      expect(h.constructed).toEqual([{ id: 'one', transport: { source: 'connection default' }, nickname: 'Endpoint', profile: { age: 18 } }]);
      expect(h.index.profile(h.canonicalId)!.peek().values).toEqual({ nickname: 'Endpoint', age: 18, bio: 'Adapter bio', interests: ['music'] });
      expect(h.repository.writes).toEqual([]);
    } finally { await h.stop(); }
  });

  it('preserves native prototype/private-field receivers and merged configuration', async () => {
    const h = await fixture({ nickname: 'Default', profile: { interests: ['music'], bio: 'Shared' }, endpoints: [
      { id: 'one', nickname: 'Override', profile: { bio: 'Endpoint' } },
    ] });
    try {
      const port = h.index.profile(h.canonicalId)!;
      expect(port.peek()).toMatchObject({ values: { nickname: 'Login cache', interests: ['music'], bio: 'Endpoint' } });
      expect((await port.read({ signal: signal() })).values.nickname).toBe('Native');
      expect(h.profiles[0]!.reads[0]).toBeInstanceOf(AbortSignal);
    } finally { await h.stop(); }
  });

  it('does not rebind a captured profile to a restarted account', async () => {
    const h = await fixture();
    try {
      const port = h.index.profile(h.canonicalId)!;
      const account = h.account.list()[0]!;
      await h.account.stop(account.instanceId, h.account.revision);
      await h.account.start(account.instanceId, h.account.revision);
      await expect(port.read({ signal: signal() })).rejects.toMatchObject({ disposition: 'not_sent' });
      expect(() => port.peek()).toThrow();
      expect(h.profiles[1]!.reads).toEqual([]);
    } finally { await h.stop(); }
  });

  it('keeps profiles from different actual accounts independent', async () => {
    const h = await fixture({ endpoints: [{ id: 'one' }, { id: 'two' }] });
    try {
      const [one, two] = h.account.list();
      await h.index.profile(one!.canonicalId)!.write!({ signal: signal(), change: { field: 'nickname', value: 'First' } });
      expect(h.index.profile(one!.canonicalId)!.peek().values.nickname).toBe('First');
      expect(h.index.profile(two!.canonicalId)!.peek().values.nickname).toBe('Login cache');
      expect(h.profiles[1]!.writes).toEqual([]);
    } finally { await h.stop(); }
  });

  it('gives an explicitly replaced account a fresh profile and rejects the old profile capability', async () => {
    const h = await fixture({ id: 'native', profile: { interests: ['music'] } });
    try {
      const old = h.account.list()[0]!;
      const captured = h.index.profile(old.canonicalId)!;
      await captured.write!({ signal: signal(), change: { field: 'nickname', value: 'Old account name' } });
      await h.account.replace(old.instanceId, h.account.revision, { endpointId: old.endpointId, config: { id: 'native', profile: { bio: 'New account' } } });
      const replacement = h.account.list()[0]!;
      expect(replacement.instanceId).not.toBe(old.instanceId);
      await h.account.start(replacement.instanceId, h.account.revision);
      expect(h.index.profile(replacement.canonicalId)!.peek().values).toEqual({ nickname: 'Login cache', interests: ['music'], bio: 'New account' });
      await expect(captured.read({ signal: signal() })).rejects.toMatchObject({ code: 'endpoint_not_found' });
      expect(h.profiles[1]!.reads).toEqual([]);
    } finally { await h.stop(); }
  });

  it('cancels the captured profile read on account stop without recording a late result', async () => {
    const h = await fixture();
    const pending = deferred<SelfProfile>();
    h.profiles[0]!.pending = pending.promise;
    try {
      const port = h.index.profile(h.canonicalId)!;
      const read = port.read({ signal: signal() });
      const rejected = expect(read).rejects.toMatchObject({ code: 'endpoint_inactive' });
      const aborted = new Promise<void>(resolve => h.profiles[0]!.reads[0]!.addEventListener('abort', () => resolve(), { once: true }));
      const account = h.account.list()[0]!;
      const stopping = h.account.stop(account.instanceId, h.account.revision);
      await aborted;
      await rejected;
      pending.resolve({ nickname: 'Late' });
      await stopping;
      await h.account.start(account.instanceId, h.account.revision);
      expect(h.index.profile(h.canonicalId)!.peek().values.nickname).toBe('Login cache');
    } finally { await h.stop(); }
  });
});

it('retains common profile defaults when adding accounts and patches only the selected account', async () => {
  const h = await accountRuntimeFixture({ config: { nickname: 'Adapter', profile: { interests: ['music'], bio: 'Shared' }, endpoints: [] } });
  await h.adapter.add(h.adapter.revision, { endpointId: 'new', config: { nickname: 'Endpoint', profile: { bio: 'Own' } } });
  const account = h.adapter.list()[0]!;
  await h.adapter.start(account.instanceId, h.adapter.revision);
  expect(h.index.profile(account.canonicalId)!.peek().values).toEqual({ nickname: 'Endpoint', interests: ['music'], bio: 'Own' });
  await h.adapter.patchConfiguration(account.instanceId, h.adapter.revision, { nickname: 'Configured rename', 'profile.age': 18 });
  expect(h.index.profile(account.canonicalId)!.peek().values).toEqual({ nickname: 'Configured rename', interests: ['music'], bio: 'Own', age: 18 });
  const writes = h.repository.compareAndSet.mock.calls.length;
  expect(() => h.adapter.patchConfiguration(account.instanceId, h.adapter.revision, { 'profile.age': -1 }))
    .toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
  expect(h.repository.compareAndSet.mock.calls).toHaveLength(writes);
  expect(h.index.profile(account.canonicalId)!.peek().values.age).toBe(18);
  const persisted = h.repository.state.get(h.adapter.descriptor.id)!.endpoints[0]!.config;
  expect(persisted.profile).toEqual({ bio: 'Own', age: 18 });
  expect(persisted.nickname).toBe('Configured rename');
  for (const profile of [{ nickname: 'Hidden alias' }, { unexpected: 'Hidden data' }]) {
    expect(() => h.adapter.patchConfiguration(account.instanceId, h.adapter.revision, { profile }))
      .toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
    expect(h.repository.compareAndSet.mock.calls).toHaveLength(writes);
    expect(h.repository.state.get(h.adapter.descriptor.id)!.endpoints[0]!.config).toEqual(persisted);
  }
});
