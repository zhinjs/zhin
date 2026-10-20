import { describe, expect, it, vi } from 'vitest';

const transportMocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
}));

vi.mock('undici', () => ({
  ProxyAgent: class {
    close = transportMocks.close;
  },
  fetch: vi.fn(),
}));

import { AiHttpTransport, resolveAiProxyUrl } from '../../src/llm/http-transport.js';

describe('AI HTTP transport configuration', () => {
  it('resolves each owner environment independently', () => {
    expect(resolveAiProxyUrl({ HTTPS_PROXY: ' https://left.proxy ' }))
      .toBe('https://left.proxy');
    expect(resolveAiProxyUrl({ HTTP_PROXY: 'http://right.proxy' }))
      .toBe('http://right.proxy');
    expect(resolveAiProxyUrl({})).toBeUndefined();
  });

  it('closes its owned proxy agent', async () => {
    const transport = new AiHttpTransport({ proxyUrl: 'http://proxy.example' });
    await transport.dispose();
    expect(transportMocks.close).toHaveBeenCalledOnce();
  });
});
