import { describe, expect, it, vi } from 'vitest';
import { runInboundMessage } from '../src/built/inbound-runner.js';
import { Plugin } from '../src/plugin.js';

function makeMessage(): any {
  return {
    $bot: 'bot1',
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

  it('does not call legacy middleware on the IM inbound path', async () => {
    const plugin = new Plugin('/test/plugin.ts');
    const middleware = vi.fn(async (_message, next) => { await next(); });
    plugin.addMiddleware(middleware);

    await runInboundMessage({
      plugin,
      message: makeMessage(),
      emitAdapterObservers: () => {},
    });

    expect(middleware).not.toHaveBeenCalled();
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

