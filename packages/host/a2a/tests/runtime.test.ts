import { afterEach, describe, expect, it } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http';
import { AgentBindingRegistry } from '@zhin.js/agent/config';
import type { AgentHostPort } from '@zhin.js/agent/runtime';
import { installRuntimeA2a } from '../src/runtime.js';

const hosts: Array<ReturnType<typeof createHttpHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('Runtime A2A Host', () => {
  it('rejects an unauthenticated production endpoint', () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const registry = new AgentBindingRegistry({
      zhin: { provider: 'ollama', model: 'qwen3:8b' },
    });
    expect(() => installRuntimeA2a({
      http,
      agentHost: {
        service: { getBindingRegistry: () => registry },
        agent: {},
      } as unknown as AgentHostPort,
      config: { path: '/mesh' },
      fallbackPublicUrl: 'https://bot.example.test',
      production: true,
    })).toThrow('requires a2a.token or http.token');
  });

  it('serves authenticated Agent Cards from the active binding registry', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const registry = new AgentBindingRegistry({
      zhin: { provider: 'ollama', model: 'qwen3:8b' },
    });
    const agentHost = {
      service: { getBindingRegistry: () => registry },
      agent: {},
    } as unknown as AgentHostPort;
    installRuntimeA2a({
      http,
      agentHost,
      config: { path: '/mesh', token: 'mesh-token' },
      fallbackPublicUrl: 'https://bot.example.test',
    });
    const { port } = await http.listen();
    const url = `http://127.0.0.1:${port}/mesh/zhin/.well-known/agent-card.json`;

    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(url, {
      headers: { authorization: 'Bearer mesh-token' },
    });
    expect(response.status).toBe(200);
    const card = await response.json() as { name: string; supportedInterfaces: Array<{ url: string }> };
    expect(card.name).toBe('zhin');
    expect(card.supportedInterfaces[0]?.url).toBe('https://bot.example.test/mesh/zhin/jsonrpc');
  });
});
