import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createConsoleEventHub } from '../src/console-events.js';

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
    const hub = createConsoleEventHub();
    const first = stubResponse();
    const second = stubResponse();
    hub.subscribe(first.response);
    hub.subscribe(second.response);

    hub.publish('endpoint:message', { adapter: 'icqq', content: 'hi' });
    hub.publish('message.receive', { adapter: 'icqq', content: 'hi' });

    expect(first.written).toEqual([
      'id: 1\nevent: endpoint:message\ndata: {"adapter":"icqq","content":"hi"}\n\n',
      'id: 2\nevent: message.receive\ndata: {"adapter":"icqq","content":"hi"}\n\n',
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
});
