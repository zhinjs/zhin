import { EventEmitter } from 'node:events';
import { createEndpointSpecification, endpointSpec, type Endpoint, type EndpointEvent } from 'zhin.js/adapter';
import { createEndpointHarness } from './endpoint.js';

class NativeEndpoint extends EventEmitter implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start: signal => signal.throwIfAborted(), open() {}, close() {}, stop() {},
  });
}

it('attaches the same canonical conversation to an incoming message and its MessageRef without changing the raw event', async () => {
  const received: EndpointEvent[] = [];
  const harness = await createEndpointHarness(() => new NativeEndpoint(), { name: 'native', gateway: { receive: async event => { received.push(event); } } });
  const event = { platform_field: 'retained' };
  const input = { event, conversation: { kind: 'group' as const, id: 'room' }, content: 'hello',
    message: { conversation: { endpoint: { id: 'codec-placeholder', adapter: 'wrong' }, kind: 'group' as const, id: 'room' }, id: 'message-id' } };
  try {
    await harness.start(); harness.open();
    await harness.endpoint[endpointSpec].events.message(input);
    expect(received).toHaveLength(1);
    const payload = received[0].payload as typeof input;
    expect(payload.message.conversation).toBe(payload.conversation);
    expect(payload.message.conversation.endpoint).toEqual({ id: harness.canonicalId, adapter: 'native' });
    expect(payload.event).toBe(event); expect(received[0].client).toBe(harness.endpoint);
    expect(input.message.conversation.endpoint).toEqual({ id: 'codec-placeholder', adapter: 'wrong' });
  } finally { await harness.stop(); }
});

it('lists a native Endpoint management capability without exposing its raw port or invoking it', async () => {
  const { listEndpointManagementCapabilities, resolveEndpointManagement } = await import('zhin.js/adapter');
  const listGroups = vi.fn(async () => []);
  class ManagedEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, management: { listGroups } });
  }
  const harness = await createEndpointHarness(() => new ManagedEndpoint());
  try {
    expect(listEndpointManagementCapabilities(harness.endpoint)).toEqual(['listGroups']);
    expect(resolveEndpointManagement(harness.endpoint)).toBeUndefined();
    expect(Reflect.get(harness.endpoint, 'management')).toBeUndefined();
    expect(listGroups).not.toHaveBeenCalled();
    await harness.start(); harness.open();
    await harness.index.management(harness.canonicalId)!.listGroups!();
    expect(listGroups).toHaveBeenCalledOnce();
  } finally { await harness.stop(); }
});

it('suspends framework ingress on owner close and resumes the same Client on rollback', async () => {
  const receive = vi.fn(async () => undefined);
  const harness = await createEndpointHarness(() => new NativeEndpoint(), { gateway: { receive } });
  const events = harness.endpoint[endpointSpec].events;
  try {
    await harness.start(); harness.open();
    await events.emit('message.receive', { content: 'before' }); expect(receive).toHaveBeenCalledOnce();
    await harness.close();
    await events.emit('message.receive', { content: 'closed' }); expect(receive).toHaveBeenCalledOnce();
    await expect(events.emitAccepted('message.receive', { content: 'closed reliable' })).rejects.toThrow(/closed/u);
    harness.open();
    await events.emit('message.receive', { content: 'after rollback' }); expect(receive).toHaveBeenCalledTimes(2);
  } finally { await harness.stop(); }
  await events.emit('message.receive', { content: 'retired' }); expect(receive).toHaveBeenCalledTimes(2);
});

it.each(['direct', 'nested'] as const)('drains a complete admitted %s callback while refusing new callbacks during close', async mode => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const ready = new Promise<void>(resolve => { release = resolve; });
  const receive = vi.fn(async () => undefined), closeHook = vi.fn();
  class ParsingEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close: closeHook, stop() {} });
  }
  const harness = await createEndpointHarness(() => new ParsingEndpoint(), { gateway: { receive } });
  const events = harness.endpoint[endpointSpec].events;
  let parsing: Promise<unknown> | undefined, closing: Promise<unknown> | undefined;
  try {
    await harness.start(); harness.open();
    parsing = events.run(async () => {
      enter(); await ready;
      const dispatch = () => events.emit('message.receive', { content: 'accepted before close' });
      await (mode === 'nested' ? events.run(dispatch) : dispatch());
    });
    await entered;
    let closed = false;
    closing = harness.close().then(() => { closed = true; });
    await vi.waitFor(() => expect(closeHook).toHaveBeenCalledOnce());
    await expect(events.run(() => events.emit('message.receive', { content: 'too late' }))).rejects.toThrow(/closed/u);
    expect(closed).toBe(false); expect(receive).not.toHaveBeenCalled();
    release(); await parsing; await closing;
    expect(closed).toBe(true); expect(receive).toHaveBeenCalledOnce();
  } finally { release(); await Promise.allSettled([parsing, closing]); await harness.stop(); }
});

it('does not let an escaped continuation reuse an already completed receipt after close', async () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const receive = vi.fn(async () => undefined);
  const harness = await createEndpointHarness(() => new NativeEndpoint(), { gateway: { receive } });
  let escaped: Promise<unknown> | undefined;
  try {
    await harness.start(); harness.open();
    const events = harness.endpoint[endpointSpec].events;
    await events.run(() => { escaped = ready.then(() => events.run(() => events.emit('message.receive', {}))); });
    await harness.close(); release();
    await expect(escaped).rejects.toThrow(/closed/u);
    expect(receive).not.toHaveBeenCalled();
  } finally { release(); await Promise.allSettled([escaped]); await harness.stop(); }
});

it.each(['close', 'stop'] as const)('rejects owner %s from its own receive before changing lifecycle state', async action => {
  const receive = vi.fn(async () => {
    await expect(harness[action]()).rejects.toThrow(/own inbound receive/u);
    expect(harness.adapter.list()[0].admitted).toBe(true);
  });
  const harness = await createEndpointHarness(() => new NativeEndpoint(), { gateway: { receive } });
  try {
    await harness.start(); harness.open();
    await harness.endpoint[endpointSpec].events.emit('message.receive', { content: 'self close' });
    expect(receive).toHaveBeenCalledOnce(); expect(harness.adapter.list()[0].started).toBe(true);
  } finally { await harness.stop(); }
});

it('retains and drains a raw-event publication even when the SDK callback does not await it', async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const ready = new Promise<void>(resolve => { release = resolve; });
  const closeHook = vi.fn();
  class RawEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close: closeHook, stop() {} });
  }
  const harness = await createEndpointHarness(() => new RawEndpoint(), { gateway: { receive: async () => {
    enter(); await ready;
    await expect(harness.close()).rejects.toThrow(/own inbound receive/u);
  } } });
  let publication: Promise<unknown> | undefined, closing: Promise<unknown> | undefined;
  try {
    await harness.start(); harness.open();
    const events = harness.endpoint[endpointSpec].events;
    await events.run(() => { publication = events.platform('raw', { native: true }); });
    await entered;
    let closed = false;
    closing = harness.close().then(() => { closed = true; });
    await vi.waitFor(() => expect(closeHook).toHaveBeenCalledOnce());
    expect(closed).toBe(false);
    release(); await publication; await closing;
    expect(closed).toBe(true);
  } finally { release(); await Promise.allSettled([publication, closing]); await harness.stop(); }
});
