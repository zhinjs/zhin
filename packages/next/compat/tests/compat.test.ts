import { describe, expect, it, vi } from 'vitest';
import { childPluginId, rootPluginId } from '@zhin.js/plugin-runtime';
import { defineLegacyCommand, defineLegacyMiddleware } from '../src/index.js';

describe('legacy definition adapters', () => {
  it('preserves the MessageCommand callback shape without a registry', async () => {
    const action = vi.fn((_message: { text: string }, result) => (
      `${result.params.name}:${result.args.join(',')}`
    ));
    const command = defineLegacyCommand({ description: 'hello', action });
    const owner = childPluginId(rootPluginId(), 'legacy');
    const value = await command.execute({
      owner: { id: owner, instanceKey: 'legacy', parent: rootPluginId(), root: rootPluginId(), role: 'child' },
      config: {},
      use() { throw new Error('unused'); },
      args: ['tail'],
      params: { name: 'alice' },
      input: { text: 'hello' },
    });
    expect(value).toBe('alice:tail');
    expect(action).toHaveBeenCalledWith(
      { text: 'hello' },
      { params: { name: 'alice' }, args: ['tail'] },
    );
  });

  it('adapts legacy middleware input and next', async () => {
    const trace: string[] = [];
    const middleware = defineLegacyMiddleware<string>(async (input, next) => {
      trace.push(input);
      await next();
    });
    await middleware.handle({
      owner: { id: rootPluginId(), instanceKey: 'root', root: rootPluginId(), role: 'root' },
      config: {},
      use() { throw new Error('unused'); },
      input: 'message',
    }, async () => { trace.push('next'); });
    expect(trace).toEqual(['message', 'next']);
  });
});
