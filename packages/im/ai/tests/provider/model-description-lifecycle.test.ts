import { createInferenceRuntime } from '../../src/provider/runtime.js';
import { defineProvider, type ProviderDriverLease } from '../../src/provider/driver.js';
import { context, graphFixture } from './fixtures.js';

it.each(['release', 'cancel'] as const)('waits for a pending description Driver lease after %s and releases it once', async action => {
  const graph = graphFixture();
  let acquired: (lease: ProviderDriverLease) => void = () => undefined;
  let entered: () => void = () => undefined;
  const lease = new Promise<ProviderDriverLease>(resolve => { acquired = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const describeModel = vi.fn(() => ({}));
  const parse = vi.fn((value: unknown) => value);
  const release = vi.fn();
  const definition = defineProvider({ id: 'fixture', contractVersion: '1',
    authentication: { methods: ['none'] }, serviceSchema: { parse },
    targets: () => ({ authentication: [], inference: [] }), models: service => service.models, describeModel,
    createExecution: () => { throw new Error('Description must not construct an execution'); } });
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async () => { entered(); return lease; } },
    credentials: () => { throw new Error('No credential access'); },
    fetch: () => async () => { throw new Error('No provider calls'); } });
  const controller = new AbortController();
  const scope = await runtime.openScope({ context, signal: controller.signal });
  const description = scope.describeModel({ purpose: 'chat' });
  await started;
  if (action === 'cancel') controller.abort(new Error('Turn cancelled'));
  let closed = false;
  const closing = scope.close().then(() => { closed = true; });
  await new Promise<void>(resolve => { setImmediate(resolve); });
  expect(closed).toBe(false);
  const rejected = expect(description).rejects.toThrow('operation-closed');
  acquired({ reference: graph.services.service.driver, definition, release });
  await rejected;
  await closing;
  expect(describeModel).not.toHaveBeenCalled();
  expect(parse).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledTimes(1);
  runtime.retire();
});
