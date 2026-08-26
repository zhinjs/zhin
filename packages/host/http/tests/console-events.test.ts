import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createConsoleEventHub, serializeConsoleEvent } from '../src/console-events.js';

type WriteCallback = (error?: Error | null) => void;

function stubResponse(
  onWrite?: (chunk: string, callback?: WriteCallback) => void,
): { response: ServerResponse; written: string[] } {
  const written: string[] = [];
  const emitter = new EventEmitter();
  const response = Object.assign(emitter, {
    write(chunk: string, callback?: WriteCallback) {
      written.push(chunk);
      onWrite?.(chunk, callback);
      return true;
    },
  });
  return { response: response as unknown as ServerResponse, written };
}

describe('console event hub', () => {
  it('fans out published events to every subscriber with incrementing ids', () => {
    const hub = createConsoleEventHub({ runtimeId: 'runtime-test' });
    const first = stubResponse();
    const second = stubResponse();
    hub.subscribe(first.response);
    hub.subscribe(second.response);

    const firstEvent = hub.publish('endpoint:message', { adapter: 'icqq', content: 'hi' });
    const secondEvent = hub.publish('message.receive', { adapter: 'icqq', content: 'hi' });

    expect(first.written).toEqual([
      serializeConsoleEvent(firstEvent),
      serializeConsoleEvent(secondEvent),
    ]);
    expect(second.written).toEqual(first.written);
    expect(hub.subscriberCount).toBe(2);
  });

  it('removes subscribers whose writes fail', () => {
    const hub = createConsoleEventHub();
    const broken = stubResponse((_chunk, callback) => callback?.(new Error('socket closed')));
    const healthy = stubResponse();
    hub.subscribe(broken.response);
    hub.subscribe(healthy.response);

    hub.publish('sync', { key: 'pages' });
    expect(hub.subscriberCount).toBe(1);

    hub.publish('init-data', { timestamp: 1 });
    expect(healthy.written).toHaveLength(2);
  });

  it('removes subscribers that throw synchronously on write', () => {
    const hub = createConsoleEventHub();
    const emitter = new EventEmitter();
    const throwing = Object.assign(emitter, {
      write() { throw new Error('destroyed'); },
    }) as unknown as ServerResponse;
    hub.subscribe(throwing);

    hub.publish('hmr:reload', { generation: 2 });
    expect(hub.subscriberCount).toBe(0);
  });

  it('drops subscribers when the connection closes', () => {
    const hub = createConsoleEventHub();
    const { response } = stubResponse();
    hub.subscribe(response);
    expect(hub.subscriberCount).toBe(1);

    response.emit('close');
    expect(hub.subscriberCount).toBe(0);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = createConsoleEventHub();
    const { response, written } = stubResponse();
    const unsubscribe = hub.subscribe(response);

    hub.publish('config:updated', { pluginName: 'icqq' });
    unsubscribe();
    hub.publish('config:updated', { pluginName: 'icqq-2' });

    expect(written).toHaveLength(1);
    expect(hub.subscriberCount).toBe(0);
  });

  it('delivers immutable snapshots to trusted in-process listeners and isolates failures', () => {
    const hub = createConsoleEventHub({runtimeId: 'runtime-bridge'});
    const received: unknown[] = [];
    hub.listen(() => { throw new Error('broken bridge'); });
    const stop = hub.listen(event => received.push(event));
    const published = hub.publish('message.receive', {content: 'hello'});
    stop();
    hub.publish('message.receive', {content: 'ignored'});
    expect(received).toEqual([published]);
    expect(Object.isFrozen(received[0])).toBe(true);
  });

  it('serves bounded paginated history and reports cursor gaps', () => {
    const hub = createConsoleEventHub({ runtimeId: 'runtime-a', historyLimit: 3 });
    for (let index = 1; index <= 5; index += 1) hub.publish('test', { index });

    expect(hub.history({ runtimeId: 'runtime-a', after: 2, limit: 2 })).toMatchObject({
      runtimeId: 'runtime-a',
      oldestAvailableEventId: 3,
      latestEventId: 5,
      nextAfter: 4,
      hasMore: true,
      gap: false,
      items: [{ eventId: 3 }, { eventId: 4 }],
    });
    expect(hub.history({ runtimeId: 'runtime-a', after: 1 })).toMatchObject({ gap: true });
    expect(hub.history({ runtimeId: 'old-runtime', after: 99 })).toMatchObject({
      gap: true,
      items: [{ eventId: 3 }, { eventId: 4 }, { eventId: 5 }],
    });
  });

  it('replays missed events before joining live delivery', () => {
    const hub = createConsoleEventHub({ runtimeId: 'runtime-a' });
    hub.publish('test', { index: 1 });
    const missed = hub.publish('test', { index: 2 });
    const { response, written } = stubResponse();
    hub.subscribe(response, { runtimeId: 'runtime-a', after: 1 });
    const live = hub.publish('test', { index: 3 });

    expect(written).toEqual([serializeConsoleEvent(missed), serializeConsoleEvent(live)]);
  });

  it('snapshots JSON payloads and rejects unsafe event amplification', () => {
    const hub = createConsoleEventHub({ runtimeId: 'runtime-a' });
    const payload = { nested: { value: 1 } };
    hub.publish('test', payload);
    payload.nested.value = 2;
    expect(hub.history().items[0]?.data).toEqual({ nested: { value: 1 } });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => hub.publish('test', circular)).toThrow();
    expect(() => hub.publish('test', { value: 'x'.repeat(300_000) })).toThrow(/exceeds/u);
  });

  it('bounds journal and history pages by bytes', () => {
    const hub = createConsoleEventHub({
      runtimeId: 'runtime-a',
      historyByteLimit: 70_000,
      historyPageByteLimit: 45_000,
    });
    hub.publish('test', { value: 'a'.repeat(40_000) });
    hub.publish('test', { value: 'b'.repeat(40_000) });
    const page = hub.history({ after: 0, limit: 500 });
    expect(page.gap).toBe(true);
    expect(page.oldestAvailableEventId).toBe(2);
    expect(page.items).toHaveLength(1);
  });

  it('disconnects an SSE subscriber when the writable applies backpressure', () => {
    const hub = createConsoleEventHub({ runtimeId: 'runtime-a' });
    const emitter = new EventEmitter();
    let destroyed = false;
    const response = Object.assign(emitter, {
      write(_chunk: string, _callback?: WriteCallback) { return false; },
      destroy() { destroyed = true; emitter.emit('close'); },
    }) as unknown as ServerResponse;
    hub.subscribe(response);
    expect(hub.subscriberCount).toBe(1);
    hub.publish('test', { value: 1 });
    expect(hub.subscriberCount).toBe(0);
    expect(destroyed).toBe(true);
  });
});
