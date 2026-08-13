import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { createNativeWebToolFeatures } from '../../src/plugin-runtime/native-web-tools.js';
import type { NetworkTransport } from '../../src/security/turn-network-client.js';

describe('native web ToolFeatures', () => {
  it('fetches readable text and searches through the same Turn network module', async () => {
    const request = vi.fn<NetworkTransport['request']>(async (url) => {
      if (url.hostname === 'www.bing.com') {
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: '<ol id="b_results"><li class="b_algo"><h2><a href="https://docs.example/guide">Guide</a></h2><p class="b_lineclamp_2">Useful <b>docs</b></p></li></ol>',
        };
      }
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: '<script>bad()</script><main>Hello <b>world</b></main>',
      };
    });
    const features = createNativeWebToolFeatures({ request });
    const fetchTool = features.find((tool) => tool.name === 'web_fetch')!;
    const searchTool = features.find((tool) => tool.name === 'web_search')!;
    const context = executionContext(['public.example', 'www.bing.com']);

    await expect(fetchTool.definition.execute({ url: 'https://public.example/page' }, context))
      .resolves.toBe('Hello world');
    await expect(searchTool.definition.execute({ query: 'guide' }, context))
      .resolves.toContain('https://docs.example/guide');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never follows a redirect outside the Turn allowlist', async () => {
    const request = vi.fn<NetworkTransport['request']>().mockResolvedValue({
      status: 302,
      statusText: 'Found',
      headers: { location: 'https://evil.example/' },
      body: '',
    });
    const fetchTool = createNativeWebToolFeatures({ request })
      .find((tool) => tool.name === 'web_fetch')!;

    await expect(fetchTool.definition.execute(
      { url: 'https://allowed.example/start' },
      executionContext(['allowed.example']),
    )).rejects.toMatchObject({ policy: 'network-access' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

function executionContext(allowedDomains: readonly string[]): ToolExecutionContext {
  return {
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey: 'session',
    origin: { kind: 'http', sessionId: 'session' },
    principal: { subjectId: 'owner', roles: ['master'] },
    policy: {
      permissions: ['master'],
      unattended: false,
      network: { enabled: true, httpsOnly: true, allowedDomains },
    },
  } as ToolExecutionContext;
}
