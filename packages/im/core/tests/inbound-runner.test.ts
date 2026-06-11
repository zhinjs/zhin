import { describe, expect, it } from 'vitest';
import { runInboundMessage } from '../src/built/inbound-runner.js';
import { Plugin } from '../src/plugin.js';

function makeMessage(): any {
  return {
    $endpoint: 'bot1',
    $adapter: 'test',
    $channel: { id: 'channel-id', type: 'private' },
    $content: [{ type: 'text', data: { text: 'hello' } }],
  };
}

describe('runInboundMessage', () => {
  it('runs dispatcher, lifecycle and adapter observers in order', async () => {
    const plugin = new Plugin('/test/plugin.ts');
    const order: string[] = [];
    plugin.$contexts.set('dispatcher', {
      name: 'dispatcher',
      description: 'mock dispatcher',
      value: {
        dispatch: async () => { order.push('dispatcher'); },
      },
    } as any);
    plugin.on('message.receive', () => order.push('lifecycle'));

    const result = await runInboundMessage({
      plugin,
      message: makeMessage(),
      emitAdapterObservers: () => order.push('adapterObserver'),
    });

    expect(result.dispatched).toBe(true);
    expect(order).toEqual(['dispatcher', 'lifecycle', 'adapterObserver']);
  });

  it('runs root middleware before MessageDispatcher when dispatcher is registered', async () => {
    const plugin = new Plugin('/test/plugin.ts');
    const order: string[] = [];
    plugin.addMiddleware(async (_message, next) => {
      order.push('middleware');
      await next();
    });
    plugin.$contexts.set('dispatcher', {
      name: 'dispatcher',
      description: 'mock dispatcher',
      value: {
        dispatch: async () => {
          order.push('dispatcher');
        },
      },
    } as any);

    await runInboundMessage({
      plugin,
      message: makeMessage(),
      emitAdapterObservers: () => {},
    });

    expect(order).toEqual(['middleware', 'dispatcher']);
  });

  it('syncs $quote_id from reply segment before dispatch', async () => {
    const plugin = new Plugin('/test/plugin.ts');
    plugin.$contexts.set('dispatcher', {
      name: 'dispatcher',
      description: 'mock dispatcher',
      value: { dispatch: async () => {} },
    } as any);
    const message = makeMessage();
    message.$content = [
      { type: 'reply', data: { message_id: '777' } },
      { type: 'text', data: { text: 'hi' } },
    ];
    await runInboundMessage({
      plugin,
      message,
      emitAdapterObservers: () => {},
    });
    expect(message.$quote_id).toBe('777');
  });

  it('reports dispatched false when no dispatcher is registered', async () => {
    const plugin = new Plugin('/test/plugin.ts');
    const order: string[] = [];

    const result = await runInboundMessage({
      plugin,
      message: makeMessage(),
      emitAdapterObservers: () => order.push('adapterObserver'),
    });

    expect(result.dispatched).toBe(false);
    expect(order).toEqual(['adapterObserver']);
  });
});

