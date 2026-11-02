import { EventEmitter } from 'node:events';
import { Adapter, createEndpointSpecification, defineAdapter, endpointSpec,
  type Endpoint, type EndpointSpecification, type EndpointMessageStream,
  type EndpointStreamRequest, type EndpointStreaming } from '../src/index.js';
import { createAdapterHarness } from '../../../../plugins/adapters/test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../../../plugins/adapters/test-utils/desired-repository.js';

class NativeMessageStream implements EndpointMessageStream {
  readonly #owner: string;
  readonly writes: string[] = [];
  readonly finishes: string[] = [];
  cancellations = 0;
  constructor(owner: string) { this.#owner = owner; }
  async write(text: string) {
    this.writes.push(text);
    return { status: 'sent' as const, acceptedText: text, messageId: `${this.#owner}:message` };
  }
  async finish(text: string) {
    this.finishes.push(text);
    return { status: 'sent' as const, acceptedText: text, messageId: `${this.#owner}:message` };
  }
  cancel() { this.cancellations++; }
}

class NativeStreaming implements EndpointStreaming {
  readonly mode = 'native';
  readonly #owner: string;
  readonly requests: EndpointStreamRequest[] = [];
  readonly streams: NativeMessageStream[] = [];
  constructor(owner: string) { this.#owner = owner; }
  supports(request: Pick<EndpointStreamRequest, 'conversation' | 'source'>) {
    return Boolean(this.#owner) && request.conversation.kind === 'private';
  }
  open(request: EndpointStreamRequest) {
    this.requests.push(request);
    const stream = new NativeMessageStream(this.#owner);
    this.streams.push(stream);
    return stream;
  }
}

async function fixture() {
  const endpoints: NativeEndpoint[] = [];
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly port = new NativeStreaming(`incarnation-${endpoints.length}`);
    readonly [endpointSpec]: EndpointSpecification = createEndpointSpecification(this, {
      start() {}, open() {}, close() {}, stop() {}, send: () => 'ordinary', streaming: this.port,
    });
  }
  class NativeAdapter extends Adapter<NativeEndpoint> {
    protected createEndpoint() { const endpoint = new NativeEndpoint(); endpoints.push(endpoint); return endpoint; }
  }
  const account = new NativeAdapter();
  const repository = new MemoryDesiredRepository(); repository.snapshot = undefined;
  const h = await createAdapterHarness(defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => account }),
    { id: 'native' }, { name: 'native', repository });
  await h.start(); h.open();
  return { ...h, account, endpoints, conversation: { endpoint: { id: h.canonicalId, adapter: 'native' }, kind: 'private' as const, id: 'room' } };
}

it('retains prototype receivers and binds stream requests to the captured account signal', async () => {
  const h = await fixture();
  const caller = new AbortController();
  const lease = h.account.acquire(h.canonicalId, caller.signal);
  try {
    expect(lease.streaming!.supports!({ conversation: h.conversation })).toBe(true);
    expect(lease.streaming!.supports!({ conversation: { ...h.conversation, kind: 'group' } })).toBe(false);
    expect(h.endpoints[0].port.requests).toEqual([]);
    const stream = lease.streaming!.open({ conversation: h.conversation, format: 'text' })!;
    expect(await stream.write('one')).toMatchObject({ messageId: 'incarnation-0:message' });
    expect(await stream.finish('one two')).toMatchObject({ acceptedText: 'one two' });
    expect(h.endpoints[0].port.streams[0].writes).toEqual(['one']);
    expect(h.endpoints[0].port.streams[0].finishes).toEqual(['one two']);
    const actualSignal = h.endpoints[0].port.requests[0].signal!;
    expect(actualSignal.aborted).toBe(false);
    caller.abort();
    expect(actualSignal.aborted).toBe(true);
    await expect(stream.write('late')).rejects.toMatchObject({ disposition: 'not_sent' });
    expect(h.endpoints[0].port.streams[0].writes).toEqual(['one']);
  } finally { lease.release(); await h.stop(); }
});

it('rejects stream admission for another account before invoking its native port', async () => {
  const h = await fixture(); const lease = h.account.acquire(h.canonicalId);
  try {
    expect(() => lease.streaming!.open({ conversation: { ...h.conversation,
      endpoint: { ...h.conversation.endpoint, id: 'another-account' } }, format: 'text' }))
      .toThrow('another account');
    expect(h.endpoints[0].port.requests).toEqual([]);
  } finally { lease.release(); await h.stop(); }
});

it('never rebinds a retired stream to a restarted account while preserving local cancellation', async () => {
  const h = await fixture(); const lease = h.account.acquire(h.canonicalId);
  let released = false;
  try {
    const stream = lease.streaming!.open({ conversation: h.conversation, format: 'text' })!;
    await stream.write('accepted');
    const retired = new Promise<void>(resolve => lease.signal.addEventListener('abort', () => resolve(), { once: true }));
    const entry = h.account.list()[0];
    const stopping = h.account.stop(entry.instanceId, h.account.revision);
    await retired;
    await expect(stream.write('late')).rejects.toMatchObject({ disposition: 'not_sent' });
    await expect(stream.finish('late')).rejects.toMatchObject({ disposition: 'not_sent' });
    stream.cancel();
    expect(h.endpoints[0].port.streams[0].cancellations).toBe(1);
    lease.release(); released = true;
    await stopping;
    await h.account.start(entry.instanceId, h.account.revision);
    const next = h.account.acquire(h.canonicalId);
    try {
      expect(next.endpoint).not.toBe(lease.endpoint);
      await next.streaming!.open({ conversation: h.conversation, format: 'text' })!.write('new');
      expect(h.endpoints[1].port.streams[0].writes).toEqual(['new']);
      expect(h.endpoints[0].port.streams[0].writes).toEqual(['accepted']);
      await expect(stream.finish('stale')).rejects.toMatchObject({ disposition: 'not_sent' });
      expect(h.endpoints[1].port.streams).toHaveLength(1);
    } finally { next.release(); }
  } finally { if (!released) lease.release(); await h.stop(); }
});
