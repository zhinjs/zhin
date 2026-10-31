import { EventEmitter } from 'node:events';
import { Adapter, createEndpointSpecification, defineAdapter, endpointSpec, type Endpoint } from '../src/index.js';
import { createAdapterHarness, createTestEndpointEventGateway } from '../../../../plugins/adapters/test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../../../plugins/adapters/test-utils/desired-repository.js';

it.each(['close', 'stop'] as const)('retains accepted normalization on %s without publishing after account cancellation', async action => {
  const receive = vi.fn(async () => undefined);
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {} });
  }
  const endpoint = new NativeEndpoint();
  const adapter = new class extends Adapter<NativeEndpoint> { protected createEndpoint() { return endpoint; } }();
  const repository = new MemoryDesiredRepository(); repository.snapshot = undefined;
  const h = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: () => adapter }), { id: 'source' }, {
    repository, gateway: createTestEndpointEventGateway({ receive }),
  });
  let finish!: () => void, entered!: () => void;
  const normalization = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  await h.start(); h.open();
  const receipt = endpoint[endpointSpec].events.run(async () => {
    entered(); await normalization;
    await endpoint[endpointSpec].events.message({ conversation: { kind: 'group', id: 'room' }, content: 'normalized', sender: { id: 'alice' } });
  }).then(value => ({ value }), error => ({ error }));
  let closing: Promise<unknown> | undefined;
  try {
    await started;
    const account = adapter.list()[0]!;
    closing = action === 'close' ? h.close() : adapter.stop(account.instanceId, adapter.revision);
    await new Promise<void>(resolve => setImmediate(resolve));
    finish();
    const outcome = await receipt; await closing;
    if (action === 'close') { expect(outcome).toEqual({ value: undefined }); expect(receive).toHaveBeenCalledOnce(); }
    else { expect(outcome).toMatchObject({ error: { code: 'inactive' } }); expect(receive).not.toHaveBeenCalled(); }
  } finally { finish(); await receipt; await closing; await h.stop(); }
});
