import { describe, it, expect, vi } from 'vitest';
import { registerGameTextMiddleware } from '../src/game-middleware.js';

describe('registerGameTextMiddleware', () => {
  it('registers on root plugin', () => {
    const dispose = vi.fn();
    const root = { addMiddleware: vi.fn(() => dispose) };
    const plugin = {
      root,
      onDispose: vi.fn(),
    };

    const mw = vi.fn();
    registerGameTextMiddleware(plugin as never, mw as never, 'test-game');

    expect(root.addMiddleware).toHaveBeenCalledWith(mw, 'test-game');
    expect(plugin.onDispose).toHaveBeenCalledWith(dispose);
  });
});
