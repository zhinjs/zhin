import { describe, it, expect, vi } from 'vitest';
import { startQqBindFlow } from '../src/qq-bind-flow.js';

describe('startQqBindFlow abort', () => {
  it('用户 cancel（AbortError）不应触发 onFailure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );

    const onFailure = vi.fn();
    const stop = startQqBindFlow(
      {
        onSuccess: vi.fn(),
        onFailure,
        onQrDisplayed: vi.fn(),
      },
      { source: 'zhin' },
    );

    stop();
    await new Promise((r) => setTimeout(r, 20));

    expect(onFailure).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
