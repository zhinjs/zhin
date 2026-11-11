import { configurationFixture, configurationPrompt } from './configuration-fixture.js';

const contextFor = (f: Awaited<ReturnType<typeof configurationFixture>>, operationId: string) => ({
  rootId: f.host.rootId, hostOwnerId: f.host.hostOwnerId, ownerId: 'personal-caller', operationId, sessionKey: 'session',
});

it.each(['language', 'image'] as const)('captures %s authority under control but does not hold control across credentials or HTTP', async kind => {
  const f = await configurationFixture();
  let began!: () => void, resume!: (key: string) => void;
  const entered = new Promise<void>(done => { began = done; });
  const key = new Promise<string>(done => { resume = done; });
  f.resolveSource.mockImplementationOnce(async () => { began(); return key; });
  const lease = await f.runtime.control(async control => control.retain());
  const inference = f.host.createInference(lease), scope = await inference.openScope({ context: contextFor(f, kind) });
  try {
    const pending = kind === 'language' ? scope.client.generate({ request: { context: configurationPrompt } })
      : scope.client.generateImage({ request: { prompt: 'synthetic image' } });
    await entered;
    await expect(f.runtime.control(async () => 'queue-free')).resolves.toBe('queue-free');
    expect(f.network).not.toHaveBeenCalled(); expect(lease.active).toBe(true);
    resume('synthetic-old-key'); await pending;
    expect(f.requests).toHaveLength(1);
    await scope.close(); inference.retire(); lease.release();
    expect(lease.active).toBe(false);
  } finally { await scope.close(); inference.retire(); lease.release(); await f.close(); }
});

it('keeps the held generation, graph and principal across config publication; the next operation reads the next graph', async () => {
  const f = await configurationFixture(), lease = await f.runtime.control(async control => control.retain());
  const inference = f.host.createInference(lease), scope = await inference.openScope({ context: contextFor(f, 'old') });
  try {
    const generation = lease.value.generation;
    await f.runtime.patchConfig([{ op: 'set', path: ['menuKeyword'], value: 'next' }]);
    await f.publish();
    expect(f.runtime.snapshot.generation).toBeGreaterThan(generation);
    expect(lease.active).toBe(true); expect(scope.context.ownerId).toBe('personal-caller'); expect(scope.graph.revision).toBe(1);
    await scope.client.generate({ request: { context: configurationPrompt } });
    const nextLease = f.runtime.snapshots.acquire(), nextRuntime = f.host.createInference(nextLease);
    const next = await nextRuntime.openScope({ context: contextFor(f, 'next') });
    try {
      expect(next.graph.revision).toBe(2); expect(next.context.ownerId).toBe('personal-caller');
      await next.client.generate({ request: { context: configurationPrompt } });
    } finally { await next.close(); nextRuntime.retire(); nextLease.release(); }
    expect(f.requests.map(request => request.url)).toEqual(['https://old.example/v1/chat/completions', 'https://next.example/v1/chat/completions']);
    expect(await f.requests[0].clone().json()).toMatchObject({ model: 'old' });
    expect(await f.requests[1].clone().json()).toMatchObject({ model: 'next' });
  } finally { await scope.close(); inference.retire(); lease.release(); await f.close(); }
});

it('cancels a held operation with its exact reason without retaining control or starting another transport', async () => {
  const f = await configurationFixture(), controller = new AbortController(), reason = new Error('synthetic caller stop');
  let began!: () => void, resume!: (key: string) => void;
  const entered = new Promise<void>(done => { began = done; });
  const key = new Promise<string>(done => { resume = done; });
  f.resolveSource.mockImplementationOnce(async () => { began(); return key; });
  const lease = await f.runtime.control(async control => control.retain()), inference = f.host.createInference(lease);
  const scope = await inference.openScope({ context: contextFor(f, 'cancel'), signal: controller.signal });
  try {
    const pending = scope.client.generate({ request: { context: configurationPrompt } });
    await entered; controller.abort(reason); resume('synthetic-old-key');
    await expect(pending).rejects.toBe(reason);
    await expect(f.runtime.control(async () => 'queue-free')).resolves.toBe('queue-free');
    expect(f.network).not.toHaveBeenCalled();
  } finally { await scope.close(); inference.retire(); lease.release(); await f.close(); }
});
