import { createModelCatalog, ModelLeaseRuntime, type ModelCatalogConfig, type ModelConnection } from '../../src/model-catalog/index.js';

function invocation(revision = 1, ownerId = 'host', baseUrl = 'https://example.test/v1') {
  const config: ModelCatalogConfig = {
    connections: { main: { id: 'main', ownerId, revision, sdk: 'openai-compatible', baseUrl, secretRef: 'secret/main' } },
    models: { chat: { id: 'chat', connectionId: 'main', model: 'chat-v1', capabilities: {} } },
    presets: { default: { id: 'default', modelId: 'chat' } },
  };
  return createModelCatalog(config).resolve('default', { ownerId, hostOwnerId: 'host' });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const created: { owner: string; revision: number; endpoint?: string }[] = [];
  const disposed: number[] = [];
  const secrets = { resolve: vi.fn(async (_connection: ModelConnection) => 'credential-value') };
  const factory = { create: vi.fn(async (connection: ModelConnection, secret: string | undefined) => {
    expect(secret).toBe('credential-value');
    const resource = { owner: connection.ownerId as string, revision: connection.revision as number, endpoint: connection.baseUrl as string | undefined };
    const index = created.push(resource) - 1;
    return { resource, dispose: vi.fn(async () => { disposed.push(index); }) };
  }) };
  return { runtime: new ModelLeaseRuntime({ secrets, factory }), created, disposed, secrets, factory };
}

describe('revision-aware model execution leases', () => {
  it('shares one resource across leases, keeps it idle for reuse, and releases idempotently', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.runtime.acquire(invocation()), h.runtime.acquire(invocation())]);
    expect(a.resource).toBe(b.resource);
    expect(h.factory.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(a.invocation)).not.toContain('credential-value');
    await a.release(); await a.release(); await b.release();
    expect(h.disposed).toEqual([]);
    const c = await h.runtime.acquire(invocation());
    expect(c.resource).toBe(a.resource);
    await c.release(); await h.runtime.dispose();
    expect(h.disposed).toEqual([0]);
  });

  it('keeps running leases on the old connection until their last release', async () => {
    const h = harness();
    const a = await h.runtime.acquire(invocation());
    const b = await h.runtime.acquire(invocation());
    const next = await h.runtime.acquire(invocation(2, 'host', 'https://changed.test/v1'));
    expect(a.resource.endpoint).toBe('https://example.test/v1');
    expect(next.resource.endpoint).toBe('https://changed.test/v1');
    await a.release(); expect(h.disposed).toEqual([]);
    await b.release(); expect(h.disposed).toEqual([0]);
    await next.release(); await h.runtime.dispose();
    expect(h.disposed).toEqual([0, 1]);
  });

  it('isolates resources and secret resolution by owner even for the same alias and revision', async () => {
    const h = harness();
    const alice = await h.runtime.acquire(invocation(1, 'alice'));
    const bob = await h.runtime.acquire(invocation(1, 'bob'));
    expect(alice.resource).not.toBe(bob.resource);
    expect(h.secrets.resolve.mock.calls.map(([connection]) => connection.ownerId)).toEqual(['alice', 'bob']);
    await alice.release(); await bob.release(); await h.runtime.dispose();
  });

  it('rejects changing a connection without advancing its revision, including after retirement', async () => {
    const h = harness();
    const a = await h.runtime.acquire(invocation());
    await expect(h.runtime.acquire(invocation(1, 'host', 'https://other.test'))).rejects.toThrow('revision-conflict');
    const next = await h.runtime.acquire(invocation(2));
    await a.release();
    await expect(h.runtime.acquire(invocation(1, 'host', 'https://other.test'))).rejects.toThrow('revision-conflict');
    await next.release(); await h.runtime.dispose();
  });

  it('late old snapshots do not replace the current connection', async () => {
    const h = harness();
    const current = await h.runtime.acquire(invocation(2));
    const old = await h.runtime.acquire(invocation(1));
    await old.release(); expect(h.disposed).toEqual([1]);
    await current.release();
    const again = await h.runtime.acquire(invocation(2));
    expect(again.resource).toBe(current.resource);
    await again.release(); await h.runtime.dispose();
  });

  it('cancels one shared creator waiter promptly without cancelling another lease', async () => {
    const pending = deferred<{ resource: object; dispose: () => Promise<void> }>();
    const dispose = vi.fn(async () => undefined);
    const factory = { create: vi.fn(() => pending.promise) };
    const runtime = new ModelLeaseRuntime({ secrets: { resolve: async () => 'secret' }, factory });
    const controller = new AbortController();
    const cancelled = runtime.acquire(invocation(), { signal: controller.signal });
    const surviving = runtime.acquire(invocation());
    controller.abort(new Error('credential-value'));
    await expect(cancelled).rejects.toThrow('cancelled');
    expect(factory.create).toHaveBeenCalledTimes(1);
    pending.resolve({ resource: {}, dispose });
    const lease = await surviving;
    expect(dispose).not.toHaveBeenCalled();
    await lease.release(); await runtime.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('reacquires an old snapshot without reusing a resource already being disposed', async () => {
    const retiring = deferred<void>();
    const disposed: number[] = [];
    let serial = 0;
    const runtime = new ModelLeaseRuntime({ secrets: { resolve: async () => 'secret' }, factory: {
      create: async () => {
        const resource = ++serial;
        return { resource, dispose: async () => {
          if (resource === 1) await retiring.promise;
          disposed.push(resource);
        } };
      },
    } });
    const first = await runtime.acquire(invocation());
    await first.release();
    const current = await runtime.acquire(invocation(2));
    const old = await runtime.acquire(invocation());
    expect(old.resource).not.toBe(first.resource);
    await old.release();
    retiring.resolve();
    await current.release(); await runtime.dispose();
    expect(disposed.sort()).toEqual([1, 2, 3]);
  });

  it('does not delay cancellation behind creation of a retired connection', async () => {
    const pending = deferred<{ resource: number; dispose: () => void }>();
    const runtime = new ModelLeaseRuntime({ secrets: { resolve: async () => 'secret' }, factory: {
      create: connection => connection.revision === 1 ? pending.promise : { resource: 2, dispose: () => undefined },
    } });
    const controller = new AbortController();
    const old = runtime.acquire(invocation(), { signal: controller.signal });
    const current = await runtime.acquire(invocation(2));
    controller.abort();
    await expect(old).rejects.toThrow('cancelled');
    pending.resolve({ resource: 1, dispose: () => undefined });
    await current.release(); await runtime.dispose();
  });

  it('evicts a creation that fails after its only waiter cancelled, so the next acquire can recover', async () => {
    const pending = deferred<{ resource: number; dispose: () => void }>();
    const factory = { create: vi.fn().mockImplementationOnce(() => pending.promise).mockImplementation(async () => ({ resource: 2, dispose: () => undefined })) };
    const runtime = new ModelLeaseRuntime<number>({ secrets: { resolve: async () => 'key' }, factory });
    const controller = new AbortController();
    const first = runtime.acquire(invocation(), { signal: controller.signal });
    controller.abort();
    await expect(first).rejects.toThrow('cancelled');
    pending.reject(new Error('synthetic late creation failure'));
    await Promise.resolve(); await Promise.resolve();
    const recovered = await runtime.acquire(invocation());
    expect(recovered.resource).toBe(2);
    expect(factory.create).toHaveBeenCalledTimes(2);
    await recovered.release(); await runtime.dispose();
  });

  it('keeps a rebuilt same-revision entry current so a later revision retires it', async () => {
    const pending = deferred<{ resource: number; dispose: () => void }>();
    let serial = 0;
    const disposed: number[] = [];
    const runtime = new ModelLeaseRuntime<number>({ secrets: { resolve: async () => 'key' }, factory: {
      create: () => {
        const resource = ++serial;
        return resource === 1 ? pending.promise : { resource, dispose: () => { disposed.push(resource); } };
      },
    } });
    const controller = new AbortController();
    const first = runtime.acquire(invocation(), { signal: controller.signal });
    controller.abort();
    await expect(first).rejects.toThrow('cancelled');
    const rebuilt = pending.promise.catch(async () => { await Promise.resolve(); return runtime.acquire(invocation()); });
    pending.reject(new Error('late failure'));
    const current = await rebuilt;
    await current.release();
    const next = await runtime.acquire(invocation(2));
    await Promise.resolve(); await Promise.resolve();
    expect(disposed).toContain(current.resource);
    await next.release(); await runtime.dispose();
  });

  it('sanitizes secret, creation and disposal failures', async () => {
    const secretFailure = new ModelLeaseRuntime({ secrets: { resolve: async () => { throw new Error('credential-value'); } }, factory: { create: vi.fn() } });
    await expect(secretFailure.acquire(invocation())).rejects.toThrow('secret-unavailable');
    const createFailure = new ModelLeaseRuntime({ secrets: { resolve: async () => 'credential-value' }, factory: { create: async () => { throw new Error('credential-value'); } } });
    await expect(createFailure.acquire(invocation())).rejects.toThrow('resource-create-failed');
    const disposeFailure = new ModelLeaseRuntime({ secrets: { resolve: async () => 'credential-value' }, factory: { create: async () => ({ resource: {}, dispose: async () => { throw new Error('credential-value'); } }) } });
    const lease = await disposeFailure.acquire(invocation()); await lease.release();
    await expect(disposeFailure.dispose()).rejects.toThrow('resource-dispose-failed');
  });

  it('stops admission during shutdown and leaves existing leases alive until release', async () => {
    const h = harness();
    const lease = await h.runtime.acquire(invocation());
    await h.runtime.dispose();
    expect(h.disposed).toEqual([]);
    await expect(h.runtime.acquire(invocation())).rejects.toThrow('disposed');
    await lease.release();
    expect(h.disposed).toEqual([0]);
  });
});
