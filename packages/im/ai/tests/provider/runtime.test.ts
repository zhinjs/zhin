import { createProfileReference, resolveProviderProfile } from '../../src/provider/selection.js';
import { defineProvider, type ProviderExecution } from '../../src/provider/driver.js';
import { createProviderResourceKey } from '../../src/provider/resources.js';
import { assistant, context, graphFixture, runtimeFixture } from './fixtures.js';

const request = { context: { systemPrompt: '', messages: [] } };
describe('owned provider inference', () => {
  it('lists typed contracts, generates once and releases execution/driver', async () => {
    let disposed = 0;
    const fixture = runtimeFixture({ execution: { language: { generate: async () => assistant(),
      stream: async () => (async function* () {})() }, dispose: () => { disposed++; } } });
    const client = await fixture.runtime.openOperation({ context });
    const choices = await client.list({ kind: 'language' });
    expect(choices.map(choice => choice.reference.kind)).toEqual(['language']);
    const result = await client.generate({ request });
    expect(result.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(result.providerStateScope?.accountIncarnation).toBe('first');
    expect(disposed).toBe(1); expect(fixture.calls.released).toBe(1);
    await client.close();
    await expect(client.generate({ request })).rejects.toThrow('operation-closed');
  });
  it('preserves successful generate/image/evaluate results and original errors when cleanup fails', async () => {
    const original = new Error('inference failed');
    let fail = false;
    const execution: ProviderExecution = {
      language: { generate: async () => { if (fail) throw original; return assistant(); }, stream: async () => (async function* () {})() },
      image: { generate: async () => ({ base64: 'aW1hZ2U=', mimeType: 'image/png', model: 'image' }) },
      decision: { evaluate: async ({ questions }) => ({ model: 'decision', usage: { inputTokens: 1, outputTokens: 1 },
        answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', noul: 0.8 }])) }) as never },
      dispose: () => { throw new Error('dispose failed'); },
    };
    const observed: string[] = [];
    const fixture = runtimeFixture({ execution, release: () => { throw new Error('release failed'); },
      onCleanupError: event => { observed.push(event.phase); throw new Error('observer failed'); } });
    const client = await fixture.runtime.openOperation({ context });
    expect((await client.generate({ request })).stopReason).toBe('stop');
    expect((await client.generateImage({ request: { prompt: 'synthetic' } })).model).toBe('image');
    const profile = (await client.list({ kind: 'decision' }))[0].reference;
    expect((await client.evaluate({ profile, state: null, questions: { answer: { type: 'noul' } } })).answers.answer.noul).toBe(0.8);
    fail = true; await expect(client.generate({ request })).rejects.toBe(original);
    expect(fixture.runtime.cleanupState().failureCount).toBe(8);
    expect(observed).toEqual(Array.from({ length: 4 }, () => ['driver-dispose', 'driver-release']).flat());
    await client.close();
  });
  it('rechecks dynamic consumption policy, and policy errors do not become permission', async () => {
    let permission: boolean | Error = true;
    const fixture = runtimeFixture({ canUseProfile: () => { if (permission instanceof Error) throw permission; return permission; } });
    const client = await fixture.runtime.openOperation({ context });
    await client.generate({ request }); permission = false;
    await expect(client.generate({ request })).rejects.toThrow('forbidden');
    permission = new Error('policy storage unavailable');
    await expect(client.list({ kind: 'language' })).rejects.toBe(permission);
    expect(fixture.calls.created).toBe(1); await client.close();
  });
  it('pulls stream only on demand, permits one consumer and releases on break', async () => {
    let reads = 0, closed = 0;
    const fixture = runtimeFixture({ execution: { language: { generate: async () => assistant(), stream: async () => (async function* () {
      try { reads++; yield { type: 'text_delta' as const, text: 'first' }; reads++; yield { type: 'done' as const, message: assistant() }; }
      finally { closed++; }
    })() } } });
    const client = await fixture.runtime.openOperation({ context });
    const run = await client.stream({ request });
    expect(reads).toBe(0); expect(fixture.calls.released).toBe(0);
    for await (const event of run) { expect(event.type).toBe('text_delta'); break; }
    expect(reads).toBe(1); expect(closed).toBe(1); expect(fixture.calls.released).toBe(1);
    expect(() => run[Symbol.asyncIterator]()).toThrow('multiple-stream-consumers');
    await Promise.all([run.close(), run[Symbol.asyncDispose](), client.close()]);
    expect(fixture.calls.released).toBe(1);
  });
  it('keeps terminal stream evidence and the original iterator error through failed cleanup', async () => {
    const original = new Error('stream failed');
    let fail = false;
    const fixture = runtimeFixture({ execution: { language: { generate: async () => assistant(), stream: async () => (async function* () {
      if (fail) throw original;
      yield { type: 'done' as const, message: assistant() };
    })() }, dispose: () => { throw new Error('dispose failed'); } } });
    const client = await fixture.runtime.openOperation({ context });
    const run = await client.stream({ request });
    const events = []; for await (const event of run) events.push(event);
    expect(events[0].message?.stopReason).toBe('stop'); expect(fixture.runtime.cleanupState().failureCount).toBe(1);
    fail = true;
    const failed = await client.stream({ request });
    await expect(failed[Symbol.asyncIterator]().next()).rejects.toBe(original);
    expect(fixture.runtime.cleanupState().failureCount).toBe(2); await client.close();
  });
  it('operation close releases an unconsumed stream and rejects late calls', async () => {
    const fixture = runtimeFixture(); const client = await fixture.runtime.openOperation({ context });
    await client.stream({ request }); await client.close();
    expect(fixture.calls.released).toBe(1);
  });
  it('pins an operation graph while new operations observe new profile parameters', async () => {
    const seen: unknown[] = [];
    const definition = defineProvider({ id: 'fixture', contractVersion: '1', serviceSchema: { parse: (value: unknown) => value },
      authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: ['https://example.test'] }),
      models: service => service.models, createExecution: options => { seen.push(options.binding.profile.parameters); return { language: {
        generate: async () => assistant(), stream: async () => (async function* () {})(),
      } }; } });
    const fixture = runtimeFixture({ definition });
    const first = await fixture.runtime.openOperation({ context });
    const graph = graphFixture(); fixture.setGraph({ ...graph, revision: 2, profiles: { ...graph.profiles,
      text: { ...graph.profiles.text, revision: 2, parameters: { temperature: 0.5 } } } });
    const second = await fixture.runtime.openOperation({ context: { ...context, operationId: 'new' } });
    await first.generate({ request }); await second.generate({ request });
    expect(seen).toEqual([{}, { temperature: 0.5 }]); await first.close(); await second.close();
  });
  it('cache state survives calls, token-free idle state does not retain a Driver lease, retirement waits for its operation', async () => {
    const key = createProviderResourceKey<{ visits: number }>('fixture cache');
    let created = 0, cleared = 0;
    const visits: number[] = [];
    const definition = defineProvider({ id: 'fixture', contractVersion: '1', serviceSchema: { parse: (value: unknown) => value },
      authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: ['https://example.test'] }), models: service => service.models,
      createExecution: options => { const state = options.resources.getOrCreate({ key, create: () => {
        created++; return { value: { visits: 0 }, dispose: () => { cleared++; } };
      } }); return { language: { generate: async () => { visits.push(++state.visits); return assistant(); }, stream: async () => (async function* () {})() } }; } });
    const fixture = runtimeFixture({ definition });
    const client = await fixture.runtime.openOperation({ context });
    await client.generate({ request }); await client.generate({ request });
    expect(created).toBe(1); expect(fixture.calls.released).toBe(2);
    fixture.runtime.retire(); expect(cleared).toBe(0);
    await client.generate({ request }); expect(visits).toEqual([1, 2, 3]);
    await client.close(); expect(cleared).toBe(1);
    await expect(fixture.runtime.openOperation({ context })).rejects.toThrow('operation-closed');
  });
  it('validates explicit contract and account incarnation before invoking the driver', async () => {
    const graph = graphFixture(), fixture = runtimeFixture();
    const binding = resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' });
    const reference = createProfileReference({ binding, kind: 'language' });
    const client = await fixture.runtime.openOperation({ context });
    await expect(client.generate({ request, profile: { ...reference, accountIncarnation: 'other' } })).rejects.toThrow('stale-reference');
    expect(fixture.calls.created).toBe(0); await client.close();
  });
  it.each(['creation-failure', 'already-cancelled', 'cancelled-creation'])('removes the request abort listener after %s', async mode => {
    const originalAny = AbortSignal.any.bind(AbortSignal);
    const tracked: { add: ReturnType<typeof vi.spyOn>; remove: ReturnType<typeof vi.spyOn> }[] = [];
    const any = vi.spyOn(AbortSignal, 'any').mockImplementation(signals => {
      const signal = originalAny(signals);
      tracked.push({ add: vi.spyOn(signal, 'addEventListener'), remove: vi.spyOn(signal, 'removeEventListener') });
      return signal;
    });
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const definition = defineProvider({ id: 'fixture', contractVersion: '1', serviceSchema: { parse: (value: unknown) => value },
      authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: ['https://example.test'] }), models: service => service.models,
      createExecution: async options => {
        if (mode === 'creation-failure') throw new Error('creation failed');
        entered();
        return await new Promise<ProviderExecution>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      } });
    const fixture = runtimeFixture({ definition });
    const client = await fixture.runtime.openOperation({ context });
    const controller = new AbortController();
    if (mode === 'already-cancelled') controller.abort(new Error('cancelled'));
    try {
      const pending = client.stream({ request, signal: controller.signal });
      if (mode === 'cancelled-creation') { await ready; controller.abort(new Error('cancelled')); }
      await expect(pending).rejects.toThrow(mode === 'creation-failure' ? 'creation failed' : 'cancelled');
      const ownedListener = tracked[0].add.mock.calls.find(call => call[0] === 'abort')?.[1];
      expect(ownedListener).toBeDefined();
      expect(tracked[0].remove.mock.calls.some(call => call[0] === 'abort' && call[1] === ownedListener)).toBe(true);
    } finally { await client.close(); any.mockRestore(); }
  });
});

it.each(['success', 'provider-error'] as const)('isolates async cleanup observer rejection from %s without an unhandled rejection', async outcome => {
  const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
  const original = new Error('provider original failure');
  const fixture = runtimeFixture({ execution: {
    language: { generate: async () => { if (outcome === 'provider-error') throw original; return assistant('observed result'); },
      stream: async () => (async function* () {})() },
    dispose: async () => { throw new Error('cleanup failure'); },
  }, onCleanupError: async () => { throw new Error('observer failure'); } });
  const client = await fixture.runtime.openOperation({ context });
  try {
    const result = client.generate({ request });
    if (outcome === 'success') expect((await result).content).toEqual([{ type: 'text', text: 'observed result' }]);
    else await expect(result).rejects.toBe(original);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(unhandled).not.toHaveBeenCalled();
    expect(fixture.runtime.cleanupState()).toMatchObject({ failureCount: 1, lastFailure: { phase: 'driver-dispose' } });
  } finally { await client.close(); process.off('unhandledRejection', unhandled); }
});


it.each(['generate', 'evaluate', 'image'] as const)('preserves terminal %s evidence when cancellation races with a known result', async operation => {
  for (const fail of [false, true]) {
    const controller = new AbortController();
    const original = new Error('driver original cancellation');
    const settle = <T>(value: T): T => { controller.abort(new Error('cancelled after completion')); if (fail) throw original; return value; };
    const fixture = runtimeFixture({ execution: {
      language: { generate: async () => settle(assistant('known result')), stream: async () => (async function* () {})() },
      decision: { evaluate: async () => settle({ model: 'decision', answers: {}, usage: { inputTokens: 0, outputTokens: 0 } }) as never },
      image: { generate: async () => settle({ base64: 'aW1hZ2U=', mimeType: 'image/png', model: 'image' }) },
    } });
    const client = await fixture.runtime.openOperation({ context });
    const invoke = operation === 'generate' ? client.generate({ request, signal: controller.signal })
      : operation === 'evaluate' ? client.evaluate({ profile: (await client.list({ kind: 'decision' }))[0].reference, state: {}, questions: {}, signal: controller.signal })
      : client.generateImage({ request: { prompt: 'synthetic' }, signal: controller.signal });
    if (fail) await expect(invoke).rejects.toBe(original);
    else await expect(invoke).resolves.toBeDefined();
    expect(fixture.calls.released).toBe(1);
    await client.close();
  }
});
