import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostGet } from '../../src/utils/host-http.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hostGet', () => {
  it('passes a 5s AbortSignal timeout to fetch', async () => {
    let observed: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      observed = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { ok: 1 } }),
      } as Response;
    }));

    const result = await hostGet({ baseUrl: 'http://127.0.0.1:8086/api', token: '' }, '/stats');
    expect(result.ok).toBe(true);
    expect(observed?.signal).toBeInstanceOf(AbortSignal);
    expect((observed?.signal as AbortSignal).aborted).toBe(false);
  });

  it('maps an abort timeout to a friendly error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    }));

    const result = await hostGet({ baseUrl: 'http://127.0.0.1:8086/api', token: '' }, '/stats');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain('超时');
    expect(result.error).toContain('http://127.0.0.1:8086/api');
  });
});
