import { EventEmitter } from 'node:events';
import { Adapter, createEndpointSpecification, defineAdapter, endpointSpec, type Endpoint, type EndpointEvent } from '../src/index.js';
import { createAdapterHarness, createTestEndpointEventGateway } from '../../../../plugins/adapters/test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../../../plugins/adapters/test-utils/desired-repository.js';

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const message = { conversation: { kind: 'private' as const, id: 'u1' }, content: 'run it', sender: { id: 'u1' } };

/** A real Adapter/Index; `receive` stands in for the Runtime, which may accept an event before dispatching it. */
async function harness(receive: (event: EndpointEvent) => Promise<unknown>) {
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {} });
  }
  const endpoint = new NativeEndpoint();
  const adapter = new class extends Adapter<NativeEndpoint> { protected createEndpoint() { return endpoint; } }();
  const repository = new MemoryDesiredRepository(); repository.snapshot = undefined;
  const h = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: () => adapter }), { id: 'source' }, {
    repository, gateway: createTestEndpointEventGateway({ receive }),
  });
  await h.start(); h.open();
  return { h, events: endpoint[endpointSpec].events };
}

describe('#1250 adapter-inbound-deadlock: admit / handoff', () => {
  it('admit settles with its callback while the dispatch it emitted runs on, and close still drains that dispatch', async () => {
    const turn = deferred();
    const { h, events } = await harness(async event => event.name === 'message.receive' ? turn.promise : undefined);
    try {
      let runSettled = false;
      const running = events.run(() => { void events.message(message); return 'run'; }).then(value => { runSettled = true; return value; });
      expect(await events.admit(() => { void events.message(message); return 'admitted'; })).toBe('admitted');
      await flush();
      expect(runSettled).toBe(false); // run keeps waiting for its detached dispatch
      let closed = false;
      const closing = h.close().then(() => { closed = true; });
      await flush();
      expect(closed).toBe(false); // the admitted dispatch still pins its receipt
      turn.resolve();
      await closing; expect(await running).toBe('run');
    } finally { turn.resolve(); await h.stop(); }
  });

  it('admit rejects with its callback error without waiting for detached dispatch', async () => {
    const turn = deferred();
    const { h, events } = await harness(async event => event.name === 'message.receive' ? turn.promise : undefined);
    try {
      await expect(events.admit(async () => { void events.message(message); throw new Error('normalization failed'); }))
        .rejects.toThrow('normalization failed');
    } finally { turn.resolve(); await h.stop(); }
  });

  it('handoff resolves once the Runtime accepted the event and reports the later dispatch outcome', async () => {
    const turn = deferred();
    const { h, events } = await harness(async (event) => {
      if (event.name !== 'message.receive') return undefined;
      expect(Object.keys(event)).not.toContain('accepted'); // a callback, never part of the event's data
      event.accepted?.();
      await turn.promise;
      return 'dispatched';
    });
    try {
      const { dispatched } = await events.admit(() => events.handoffMessage(message));
      let outcome: unknown;
      void dispatched.then(value => { outcome = value; }, () => undefined);
      await flush();
      expect(outcome).toBeUndefined();
      turn.reject(new Error('turn failed'));
      await expect(dispatched).rejects.toThrow('turn failed');
    } finally { turn.resolve(); await h.stop(); }
  });

  it('handoff rejects when the Runtime failed the event before accepting it, and resolves on a dispatch that never accepts', async () => {
    let fail = true;
    const { h, events } = await harness(async (event) => {
      if (event.name !== 'message.receive') return undefined;
      if (fail) throw new Error('storage unavailable');
      return 'done';
    });
    try {
      await expect(events.admit(() => events.handoff('message.receive', message))).rejects.toThrow('storage unavailable');
      fail = false;
      const { dispatched } = await events.admit(() => events.handoffMessage(message));
      expect(await dispatched).toBe('done');
    } finally { await h.stop(); }
  });

  it('handoff rejects while ingress is closed', async () => {
    const { h, events } = await harness(async () => undefined);
    try {
      await h.close();
      await expect(events.handoffMessage(message)).rejects.toThrow(/closed/);
    } finally { await h.stop(); }
  });
});
