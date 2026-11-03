import { createSnapshotView, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { EndpointProfileState } from '../src/endpoint-profile.js';
import { AdapterManagementError } from '../src/adapter-types.js';
import { accountRuntimeFixture } from './account-runtime-fixture.js';

function candidate(fixture: Awaited<ReturnType<typeof accountRuntimeFixture>>, config: Record<string, unknown>): RuntimeSnapshot {
  return createSnapshotView(1, { ...fixture.state,
    config: new Map([...fixture.state.config, [fixture.owner, config]]),
  });
}

describe('configuration-owned account profile projections', () => {
  it('keeps each fallback immutable while sharing platform evidence and account retirement', async () => {
    const write = vi.fn(async () => ({ status: 'updated' as const }));
    const state = new EndpointProfileState({ defaults: { nickname: 'Initial' }, source: {
      writableFields: ['nickname'], read: async () => ({}), write,
    } });
    const original = state.withDefaults({ nickname: 'Original' });
    const next = state.withDefaults({ nickname: 'Next' });
    expect(original.peek().values.nickname).toBe('Original');
    expect(next.peek().values.nickname).toBe('Next');
    expect(state.peek().values.nickname).toBe('Initial');
    await next.write!({ signal: new AbortController().signal, change: { field: 'nickname', value: 'Platform' } });
    expect(original.peek().values.nickname).toBe('Platform');
    expect(next.peek().values.nickname).toBe('Platform');
    expect(write).toHaveBeenCalledTimes(1);
    state.nextAccount();
    expect(() => original.peek()).toThrow('Profile account changed');
    expect(() => next.peek()).toThrow('Profile account changed');
  });

  it('updates managed nickname without stop/start and preserves captured operation fallbacks', async () => {
    const fixture = await accountRuntimeFixture({ migration: true, config: { nickname: 'Before', endpoints: [{ id: 'one' }] } });
    const record = fixture.adapter.list()[0];
    const endpoint = fixture.adapter.getEndpoint(record.instanceId)!;
    const previous = fixture.index.profile(record.canonicalId)!;
    const lease = fixture.index.acquire(record.canonicalId);
    try {
      const updated = await fixture.adapter.patchConfiguration(record.instanceId, fixture.adapter.revision, { nickname: 'After' }, { waitForExecution: false });
      expect(updated.execution.status).toBe('applied');
      expect(fixture.adapter.getEndpoint(record.instanceId)).toBe(endpoint);
      expect(endpoint.connect).toHaveBeenCalledTimes(1);
      expect(endpoint.disconnect).not.toHaveBeenCalled();
      expect(lease.signal.aborted).toBe(false);
      expect(previous.peek().values.nickname).toBe('Before');
      expect(fixture.index.profile(record.canonicalId)!.peek().values.nickname).toBe('After');
      expect(fixture.index.connection('demo', 'one')!.profile!.values.nickname).toBe('After');
      expect(fixture.repository.compareAndSet).toHaveBeenCalledTimes(1);
    } finally { lease.release(); }
  });

  it('prepares a file profile view without publishing it to the old index or rebuilding transport', async () => {
    const fixture = await accountRuntimeFixture({ noDatabase: true,
      config: { nickname: 'Old default', endpoints: [{ id: 'one', profile: { signature: 'Before' } }] } });
    const record = fixture.adapter.list()[0];
    const endpoint = fixture.adapter.getEndpoint(record.instanceId)!;
    const previous = fixture.index.profile(record.canonicalId)!;
    const next = fixture.index.prepareConfigUpdate(candidate(fixture,
      { nickname: 'New default', endpoints: [{ id: 'one', profile: { signature: 'After' } }] }), [fixture.owner])!;
    expect(next).toBeDefined();
    expect(next).not.toBe(fixture.index);
    expect(next.adapter(fixture.adapter.descriptor.id)).toBe(fixture.adapter);
    expect(next.clientById(record.canonicalId)).toBe(endpoint);
    expect(previous.peek().values).toEqual({ nickname: 'Old default', signature: 'Before' });
    expect(fixture.index.connection('demo', 'one')!.profile!.values.signature).toBe('Before');
    expect(next.profile(record.canonicalId)!.peek().values).toEqual({ nickname: 'New default', signature: 'After' });
    expect(next.connection('demo', 'one')!.profile!.values.nickname).toBe('New default');
    expect(endpoint.connect).toHaveBeenCalledTimes(1);
    expect(endpoint.disconnect).not.toHaveBeenCalled();
    expect(fixture.repository.compareAndSet).not.toHaveBeenCalled();
    await expect(next.send(record.canonicalId, { conversation: {
      endpoint: { id: record.canonicalId, adapter: 'demo' }, kind: 'private', id: 'recipient',
    }, payload: 'message after profile update' })).resolves.toBe('native-message');
  });

  it('retains managed explicit fields but refreshes inherited defaults without another CAS', async () => {
    const fixture = await accountRuntimeFixture({ migration: true,
      config: { nickname: 'Old default', profile: { signature: 'Inherited' }, endpoints: [{ id: 'one' }] } });
    const record = fixture.adapter.list()[0];
    await fixture.adapter.patchConfiguration(record.instanceId, fixture.adapter.revision, { 'profile.signature': 'Explicit' });
    expect(fixture.adapter.revision).not.toBeNull();
    const next = fixture.index.prepareConfigUpdate(candidate(fixture,
      { nickname: 'New default', profile: { signature: 'New inherited' }, endpoints: [{ id: 'one' }] }), [fixture.owner])!;
    expect(next.profile(record.canonicalId)!.peek().values).toEqual({ nickname: 'New default', signature: 'Explicit' });
    expect(fixture.index.profile(record.canonicalId)!.peek().values).toEqual({ nickname: 'Old default', signature: 'Explicit' });
    expect(fixture.repository.compareAndSet).toHaveBeenCalledTimes(1);
  });

  it('does not accept connection or account-identity differences as a pure profile projection', async () => {
    const fixture = await accountRuntimeFixture({ noDatabase: true, config: { token: 'one', endpoints: [{ id: 'one' }] } });
    expect(fixture.index.prepareConfigUpdate(candidate(fixture, { token: 'two', endpoints: [{ id: 'one' }] }), [fixture.owner])).toBeUndefined();
    expect(fixture.index.prepareConfigUpdate(candidate(fixture, { token: 'one', endpoints: [{ id: 'renamed' }] }), [fixture.owner])).toBeUndefined();
  });

  it('keeps a disabled account disabled when saving profile configuration', async () => {
    const fixture = await accountRuntimeFixture();
    const created = await fixture.adapter.add(fixture.adapter.revision, { endpointId: 'disabled', config: {} });
    const record = created.endpoints[0];
    await fixture.adapter.patchConfiguration(record.instanceId, fixture.adapter.revision, { nickname: 'Saved while disabled' });
    expect(fixture.adapter.created).toHaveLength(0);
    expect(fixture.adapter.list()[0]).toMatchObject({ desiredEnabled: false, started: false });
  });

  it('does not publish or retry a profile commit whose persistence outcome is unknown', async () => {
    const fixture = await accountRuntimeFixture({ migration: true, config: { nickname: 'Before', endpoints: [{ id: 'one' }] } });
    const record = fixture.adapter.list()[0];
    const endpoint = fixture.adapter.getEndpoint(record.instanceId)!;
    const persist = fixture.repository.compareAndSet.getMockImplementation()!;
    fixture.repository.compareAndSet.mockImplementationOnce(async (...args) => {
      await persist(...args);
      throw new AdapterManagementError('commit_unknown', 'Synthetic lost acknowledgement');
    });
    await expect(fixture.adapter.patchConfiguration(record.instanceId, fixture.adapter.revision, { nickname: 'After' }))
      .rejects.toMatchObject({ code: 'commit_unknown' });
    expect(fixture.index.profile(record.canonicalId)!.peek().values.nickname).toBe('Before');
    expect(fixture.repository.compareAndSet).toHaveBeenCalledTimes(1);
    expect(() => fixture.adapter.patchConfiguration(record.instanceId, fixture.adapter.revision, { nickname: 'Do not retry' }))
      .toThrow(expect.objectContaining({ code: 'commit_unknown' }));
    await fixture.adapter.verifyPendingCommit();
    expect(fixture.index.profile(record.canonicalId)!.peek().values.nickname).toBe('After');
    expect(fixture.adapter.getEndpoint(record.instanceId)).toBe(endpoint);
    expect(endpoint.connect).toHaveBeenCalledTimes(1);
    expect(endpoint.disconnect).not.toHaveBeenCalled();
    expect(fixture.repository.compareAndSet).toHaveBeenCalledTimes(1);
  });

  it('restores profile inheritance after deleting an explicit override, including null and empty values', async () => {
    const fixture = await accountRuntimeFixture({ migration: true,
      config: { nickname: 'Inherited', profile: { signature: 'Inherited signature' }, endpoints: [{ id: 'one' }] } });
    const record = fixture.adapter.list()[0];
    await fixture.adapter.patchConfiguration(record.instanceId, fixture.adapter.revision, { nickname: null, 'profile.signature': '' });
    const captured = fixture.index.profile(record.canonicalId)!;
    expect(captured.peek().values).toEqual({ nickname: null, signature: '' });
    await fixture.adapter.patchConfiguration(record.instanceId, fixture.adapter.revision, { nickname: undefined, 'profile.signature': undefined });
    expect(captured.peek().values).toEqual({ nickname: null, signature: '' });
    expect(fixture.index.profile(record.canonicalId)!.peek().values).toEqual({ nickname: 'Inherited', signature: 'Inherited signature' });
    expect(fixture.adapter.created).toHaveLength(1);
  });
});
