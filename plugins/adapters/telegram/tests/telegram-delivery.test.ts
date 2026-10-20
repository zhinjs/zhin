import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getEventListeners } from 'node:events';
import { bindTestEndpointEvents } from '../../test-utils/endpoint.js';
import { capabilityId, featureId, rootPluginId, createCapabilitySlot, SnapshotStore, type RuntimeSnapshot } from 'zhin.js';
import { AdapterIndex, adapterFeatureId, defineAdapter, endpointEventGatewayToken, type EndpointEvent } from 'zhin.js/adapter';
import type { HttpHost } from '@zhin.js/host-http';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { TelegramEndpoint, type TelegramFetch } from '../src/endpoint.js';
import { resolveTelegramConfig, type TelegramUpdate } from '../src/protocol.js';
import { handleTelegramWebhookRequest, type TelegramWebhookHandler } from '../src/webhook.js';
import { runTelegramPollLoop, type TelegramPollingHost } from '../src/polling.js';

const config = resolveTelegramConfig({
  id: 'delivery-test', token: '123:PRIVATE', polling: false,
  webhook: { domain: 'https://test.invalid', secretToken: 'secret' },
});
const update: TelegramUpdate = {
  update_id: 123,
  message: { message_id: 42, date: 1, chat: { id: 1, type: 'private' }, text: 'hello' },
};
const id = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'telegram');

function makeEndpoint(receive: (name: string) => Promise<unknown> = async () => undefined) {
  const endpoint = bindTestEndpointEvents(new TelegramEndpoint({ id, config }), {
    receive: async (event) => receive(event.name),
  });
  endpoint.open();
  return endpoint;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function webhook(handler: TelegramWebhookHandler, body = JSON.stringify(update), token = 'secret') {
  const request = Readable.from([body]) as IncomingMessage;
  request.headers = { 'x-telegram-bot-api-secret-token': token };
  const response = { writeHead: vi.fn(), end: vi.fn() };
  const done = handleTelegramWebhookRequest(request, response as unknown as ServerResponse, handler);
  return { response, done };
}

async function candidate(receive: (event: EndpointEvent) => Promise<unknown>) {
  const root = rootPluginId();
  const endpoint = new TelegramEndpoint({ id, config,
    http: { route: () => () => undefined } as unknown as HttpHost,
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: {} }), json: async () => ({}) }),
  });
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'telegram',
    source: '/adapters/telegram/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], operations: ['recall'], create: () => endpoint }),
  });
  const snapshot: RuntimeSnapshot = {
    generation: 1, root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/test', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map([[endpointEventGatewayToken.id, { receive }]])]]),
    capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  };
  const index = await AdapterIndex.create([slot], snapshot, new AbortController().signal);
  await index.start();
  index.open();
  const { generation: _generation, ...state } = snapshot;
  return { endpoint, index, commit: () => new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) }) };
}

describe('Telegram update admission and acknowledgement', () => {
  it('keeps candidate webhook acknowledgement pending until generation admission commits', async () => {
    const receive = vi.fn(async (_event: EndpointEvent) => undefined);
    const { endpoint, index, commit } = await candidate(receive);
    const request = webhook(endpoint);
    await new Promise((resolve) => setImmediate(resolve));
    expect(receive).not.toHaveBeenCalled();
    expect(request.response.writeHead).not.toHaveBeenCalled();
    const store = commit();
    await request.done;
    expect(receive.mock.calls.map(([event]) => event.name)).toEqual(['platform.receive', 'message.receive']);
    expect(request.response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    await index.stop();
    await store.close();
  });

  it('rejects candidate webhook acknowledgement when generation admission rolls back', async () => {
    const { endpoint, index } = await candidate(async () => undefined);
    const request = webhook(endpoint);
    await new Promise((resolve) => setImmediate(resolve));
    await index.stop();
    await request.done;
    expect(request.response.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
  });

  it('does not confirm the webhook after platform.receive alone succeeds', async () => {
    const message = deferred<void>();
    const endpoint = makeEndpoint(async (name) => name === 'message.receive' ? message.promise : undefined);
    const { response, done } = webhook(endpoint);
    await new Promise((resolve) => setImmediate(resolve));
    expect(response.writeHead).not.toHaveBeenCalled();
    message.resolve();
    await done;
    expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    await endpoint.stop();
  });

  it('returns 503 for failed canonical admission and permits a retry', async () => {
    const receive = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(undefined);
    const endpoint = makeEndpoint(async (name) => name === 'message.receive' ? receive() : undefined);
    const first = webhook(endpoint);
    await first.done;
    expect(first.response.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    const retry = webhook(endpoint);
    await retry.done;
    expect(retry.response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(receive).toHaveBeenCalledTimes(2);
    await endpoint.stop();
  });

  it('returns 503 while closed and 400 for malformed payloads', async () => {
    const handleUpdate = vi.fn();
    for (const [isOpen, body, status] of [
      [false, JSON.stringify(update), 503], [true, '{', 400], [true, 'null', 400],
      [true, JSON.stringify({ update_id: -1 }), 400],
    ] as const) {
      const request = webhook({ config, isOpen, handleUpdate }, body);
      await request.done;
      expect(request.response.writeHead).toHaveBeenCalledWith(status, expect.any(Object));
    }
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('does not admit an unauthenticated webhook', async () => {
    const handleUpdate = vi.fn();
    const request = webhook({ config, isOpen: true, handleUpdate }, JSON.stringify(update), 'wrong');
    await request.done;
    expect(request.response.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('coalesces concurrent delivery and suppresses already admitted update ids', async () => {
    const message = deferred<void>();
    const receive = vi.fn(async (name) => name === 'message.receive' ? message.promise : undefined);
    const endpoint = makeEndpoint(receive);
    const first = endpoint.handleUpdate(update);
    const duplicate = endpoint.handleUpdate(update);
    await new Promise((resolve) => setImmediate(resolve));
    expect(receive.mock.calls.filter(([name]) => name === 'message.receive')).toHaveLength(1);
    message.resolve();
    await Promise.all([first, duplicate]);
    await endpoint.handleUpdate(update);
    expect(receive).toHaveBeenCalledTimes(2); // platform + canonical once each
    await endpoint.stop();
  });

  it('acknowledges successfully drained canonical processing even if the endpoint closes meanwhile', async () => {
    const message = deferred<void>();
    const endpoint = makeEndpoint(async (name) => name === 'message.receive' ? message.promise : undefined);
    const first = webhook(endpoint);
    await new Promise((resolve) => setImmediate(resolve));
    endpoint.close();
    message.resolve();
    await first.done;
    expect(first.response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    await endpoint.stop();
  });

  it('rejects an update closed during permission lookup before canonical dispatch enters Core', async () => {
    const receive = vi.fn(async () => undefined);
    const endpoint = bindTestEndpointEvents(new TelegramEndpoint({ id, config,
      fetch: async () => new Promise(() => {}),
    }), { receive });
    endpoint.open();
    const groupUpdate = { ...update, message: { ...update.message!,
      chat: { id: 1, type: 'group' as const }, from: { id: 1, first_name: 'Alice' },
    } };
    const request = webhook(endpoint, JSON.stringify(groupUpdate));
    await new Promise((resolve) => setImmediate(resolve));
    await endpoint.stop();
    await request.done;
    expect(request.response.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    expect(receive.mock.calls.map(([event]) => event.name)).toEqual(['platform.receive']);
  });

  it('rejects excess concurrent admissions and frees capacity after completion', async () => {
    const message = deferred<void>();
    const endpoint = makeEndpoint(async (name) => name === 'message.receive' ? message.promise : undefined);
    const requests = Array.from({ length: 256 }, (_, index) => endpoint.handleUpdate({ ...update, update_id: index }));
    await expect(endpoint.handleUpdate({ ...update, update_id: 256 })).rejects.toThrow('capacity exhausted');
    message.resolve();
    await Promise.all(requests);
    await expect(endpoint.handleUpdate({ ...update, update_id: 256 })).resolves.toBeUndefined();
    await endpoint.stop();
  });

  it('bounds admitted-update deduplication by evicting the oldest accepted id', async () => {
    const deliveries = vi.fn(async () => undefined);
    const endpoint = makeEndpoint(async (name) => name === 'message.receive' ? deliveries() : undefined);
    for (let next = 0; next <= 2048; next += 1) await endpoint.handleUpdate({ ...update, update_id: next });
    await endpoint.handleUpdate({ ...update, update_id: 2048 });
    expect(deliveries).toHaveBeenCalledTimes(2049);
    await endpoint.handleUpdate({ ...update, update_id: 0 });
    expect(deliveries).toHaveBeenCalledTimes(2050);
    await endpoint.stop();
  });

  it('projects polling failure and recovery independently from generation admission', async () => {
    vi.useFakeTimers();
    let polls = 0;
    const endpoint = bindTestEndpointEvents(new TelegramEndpoint({ id,
      config: resolveTelegramConfig({ id: 'poll-health', token: '123:PRIVATE' }),
      fetch: async (url) => {
        if (url.endsWith('/getUpdates')) {
          polls += 1;
          if (polls === 1) throw new Error('network offline');
          if (polls > 2) return new Promise(() => {});
        }
        const result = url.endsWith('/getUpdates') ? [update] : {};
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result }), json: async () => ({}) };
      },
    }), { receive: async () => undefined });
    try {
      await endpoint.start();
      endpoint.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(endpoint.transportState).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(endpoint.transportState).toBe('open');
      expect(endpoint.getUpdateOffset()).toBe(124);
      await endpoint.stop();
      expect(endpoint.transportState).toBe('stopped');
      expect(vi.getTimerCount()).toBe(0);
    } finally { await endpoint.stop(); vi.useRealTimers(); }
  });

  it('keeps polling offset unchanged when admission fails', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const host: TelegramPollingHost = {
      allowedUpdates: [], getUpdateOffset: () => 0, setUpdateOffset: vi.fn(),
      callApi: vi.fn().mockResolvedValue([update, { ...update, update_id: 124 }]),
      handleUpdate: vi.fn().mockRejectedValue(new Error('not admitted')),
    };
    const loop = runTelegramPollLoop(host, abort.signal);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(host.handleUpdate).toHaveBeenCalledTimes(1);
      expect(host.setUpdateOffset).not.toHaveBeenCalled();
      abort.abort();
      await loop;
      expect(vi.getTimerCount()).toBe(0);
    } finally { abort.abort(); await loop; vi.useRealTimers(); }
  });

  it('can replay an accepted update across restart before Telegram offset confirmation', async () => {
    // Fake Telegram server forgets an update only on the next getUpdates(offset).
    const pending = [update];
    const deliveries = vi.fn(async () => undefined);
    async function generation() {
      const abort = new AbortController();
      let offset = 0;
      const endpoint = makeEndpoint(async (name) => name === 'message.receive' ? deliveries() : undefined);
      const host: TelegramPollingHost = {
        allowedUpdates: [], getUpdateOffset: () => offset,
        setUpdateOffset: (next) => { offset = next; abort.abort(); },
        handleUpdate: (next) => endpoint.handleUpdate(next),
        callApi: async <T>(_method: string, params?: Record<string, unknown>) => {
          const confirmedOffset = Number(params?.offset) || 0;
          while (pending[0] && pending[0].update_id < confirmedOffset) pending.shift();
          return [...pending] as T;
        },
      };
      await runTelegramPollLoop(host, abort.signal);
      await endpoint.stop();
      return offset;
    }
    expect(await generation()).toBe(124);
    expect(pending).toHaveLength(1); // no next offset-bearing request before shutdown
    expect(await generation()).toBe(124);
    expect(deliveries).toHaveBeenCalledTimes(2); // documented at-least-once window
  });
});

describe('Telegram Bot API deadlines and failure classification', () => {
  it('bounds response body parsing and cancels even if the fetch headers already arrived', async () => {
    vi.useFakeTimers();
    const endpoint = new TelegramEndpoint({ id, config, requestTimeoutMs: 10,
      fetch: async () => ({ ok: true, status: 200, text: async () => new Promise(() => {}), json: async () => ({}) }),
    });
    try {
      const failed = expect(endpoint.callApi('sendMessage')).rejects.toMatchObject({ kind: 'timeout', disposition: 'unknown' });
      await vi.advanceTimersByTimeAsync(10);
      await failed;
      expect(vi.getTimerCount()).toBe(0);
    } finally { await endpoint.stop(); vi.useRealTimers(); }
  });

  it('stop cancels outstanding API requests even before connection startup', async () => {
    const endpoint = new TelegramEndpoint({ id, config, fetch: async () => new Promise(() => {}) });
    const request = endpoint.callApi('sendMessage');
    const failed = expect(request).rejects.toMatchObject({ kind: 'cancelled', disposition: 'unknown' });
    await Promise.resolve();
    await endpoint.stop();
    await failed;
    expect(endpoint.transportState).toBe('stopped');
  });
  it.each(['json', 'form'] as const)('cancels a hung %s request at the deadline without retry', async (kind) => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const fetch = vi.fn<TelegramFetch>(async (_url, init) => {
      signal = init!.signal!;
      return new Promise(() => {}); // transport ignores cancellation; the caller must still settle
    });
    const endpoint = new TelegramEndpoint({ id, config, fetch, requestTimeoutMs: 10 });
    try {
      const request = kind === 'json' ? endpoint.callApi('sendMessage') : endpoint.callApiForm('sendPhoto', new FormData());
      const failed = expect(request).rejects.toMatchObject({ kind: 'timeout', disposition: 'unknown' });
      await vi.advanceTimersByTimeAsync(10);
      await failed;
      expect(signal.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { await endpoint.stop(); vi.useRealTimers(); }
  });

  it('propagates client cancellation and removes source listeners', async () => {
    const abort = new AbortController();
    const fetch = vi.fn<TelegramFetch>(async () => new Promise(() => {}));
    const endpoint = new TelegramEndpoint({ id, config, fetch });
    const request = endpoint.client.callApi('sendMessage', {}, abort.signal);
    const failed = expect(request).rejects.toMatchObject({ kind: 'cancelled', disposition: 'unknown' });
    await Promise.resolve();
    abort.abort();
    await failed;
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0);
    expect(fetch).toHaveBeenCalledOnce();
    await endpoint.stop();
  });

  it.each([
    [401, 'authentication', undefined], [429, 'rate_limit', 12], [500, 'http', undefined],
  ] as const)('classifies API status %i and never retries', async (status, kind, retryAfterSeconds) => {
    const fetch = vi.fn<TelegramFetch>(async () => ({
      ok: false, status,
      text: async () => JSON.stringify({ ok: false, error_code: status,
        description: 'rejected', parameters: { retry_after: retryAfterSeconds } }),
      json: async () => undefined,
    }));
    const endpoint = new TelegramEndpoint({ id, config, fetch });
    await expect(endpoint.callApi('sendMessage')).rejects.toMatchObject({ kind, status, retryAfterSeconds, disposition: 'rejected' });
    expect(fetch).toHaveBeenCalledOnce();
    await endpoint.stop();
  });

  it('redacts credential-bearing transport errors', async () => {
    const endpoint = new TelegramEndpoint({ id, config,
      fetch: async (url) => { throw new Error(`failed request ${url}`); },
    });
    const error = await endpoint.callApi('sendMessage').catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(EndpointDeliveryError);
    expect(error).toMatchObject({ kind: 'network', disposition: 'unknown' });
    expect(String(error)).not.toContain(config.token);
    await endpoint.stop();
  });

  it('marks cancellation before fetch as not_sent and does not attempt delivery', async () => {
    const abort = new AbortController();
    abort.abort();
    const fetch = vi.fn<TelegramFetch>();
    const endpoint = new TelegramEndpoint({ id, config, fetch });
    await expect(endpoint.callApi('sendMessage', {}, abort.signal)).rejects.toMatchObject({
      code: 'endpoint_cancelled', disposition: 'not_sent',
    });
    expect(fetch).not.toHaveBeenCalled();
    await endpoint.stop();
  });
});

describe('Telegram structured outbound delivery', () => {
  const conversation = { endpoint: { id: 'telegram', adapter: 'telegram' }, kind: 'private' as const, id: '1' };
  const images = [1, 2, 3].map((next) => ({
    type: 'image', data: { media: { kind: 'url', value: `https://test.invalid/${next}.png` } },
  }));

  it('does not claim rejection of the whole message after an earlier action succeeded', async () => {
    const fetch = vi.fn<TelegramFetch>().mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { message_id: 10 } }), json: async () => ({}),
    }).mockResolvedValueOnce({
      ok: false, status: 403, text: async () => JSON.stringify({ ok: false, error_code: 403, description: 'forbidden' }), json: async () => ({}),
    });
    const endpoint = new TelegramEndpoint({ id, config, fetch });
    const error = await endpoint.send({ conversation, payload: images }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(EndpointDeliveryError);
    expect(error).toMatchObject({ code: 'partial_delivery', disposition: 'unknown',
      cause: { code: 'platform_rejected', disposition: 'rejected', kind: 'authentication' },
    });
    expect(fetch).toHaveBeenCalledTimes(2); // third action was not attempted; no blind retry
    await endpoint.stop();
  });

  it('keeps a timeout after a successful action partial and retains its cause', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<TelegramFetch>().mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { message_id: 10 } }), json: async () => ({}),
    }).mockImplementationOnce(async () => new Promise(() => {}));
    const endpoint = new TelegramEndpoint({ id, config, fetch, requestTimeoutMs: 10 });
    try {
      const failed = expect(endpoint.send({ conversation, payload: images })).rejects.toMatchObject({
        code: 'partial_delivery', disposition: 'unknown', cause: { kind: 'timeout', disposition: 'unknown' },
      });
      await vi.advanceTimersByTimeAsync(10);
      await failed;
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { await endpoint.stop(); vi.useRealTimers(); }
  });

  it('preserves explicit rejection when no earlier action succeeded', async () => {
    const fetch = vi.fn<TelegramFetch>(async () => ({
      ok: false, status: 429, text: async () => JSON.stringify({ ok: false, error_code: 429, description: 'limited' }), json: async () => ({}),
    }));
    const endpoint = new TelegramEndpoint({ id, config, fetch });
    await expect(endpoint.send({ conversation, payload: images })).rejects.toMatchObject({
      code: 'platform_rejected', disposition: 'rejected', kind: 'rate_limit',
    });
    expect(fetch).toHaveBeenCalledOnce();
    await endpoint.stop();
  });

  it('marks invalid message preparation not_sent and incomplete receipts unknown', async () => {
    const fetch = vi.fn<TelegramFetch>(async () => ({
      ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: {} }), json: async () => ({}),
    }));
    const endpoint = new TelegramEndpoint({ id, config, fetch });
    await expect(endpoint.send({ conversation, payload: '' })).rejects.toMatchObject({ disposition: 'not_sent' });
    expect(fetch).not.toHaveBeenCalled();
    await expect(endpoint.send({ conversation, payload: 'hello' })).rejects.toMatchObject({
      code: 'delivery_unconfirmed', disposition: 'unknown',
    });
    expect(fetch).toHaveBeenCalledOnce();
    await endpoint.stop();
  });
});
