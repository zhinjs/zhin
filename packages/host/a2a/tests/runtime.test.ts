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
  it('keeps the package root inert and exposes the Runtime API', async () => {
    const entry = await import('../src/index.js');

    expect(entry.installRuntimeA2a).toBe(installRuntimeA2a);
  });

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

  it('uses the Host JSON parser limit and maps REST failures to HTTP semantics', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const registry = new AgentBindingRegistry({
      zhin: { provider: 'ollama', model: 'qwen3:8b' },
    });
    installRuntimeA2a({
      http,
      agentHost: {
        service: { getBindingRegistry: () => registry },
        agent: {},
      } as unknown as AgentHostPort,
      config: { path: '/mesh', token: 'mesh-token' },
      fallbackPublicUrl: 'https://bot.example.test',
    });
    const { port } = await http.listen();
    const endpoint = `http://127.0.0.1:${port}/mesh/zhin/rest`;
    const headers = {
      authorization: 'Bearer mesh-token',
      'content-type': 'application/json',
      'a2a-version': '1.0',
    };

    const tooLarge = await fetch(`${endpoint}/v1/message:send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: 'x'.repeat(1_048_576) }),
    });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: 'Request body exceeds 1048576 bytes' });

    const jsonRpcTooLarge = await fetch(`http://127.0.0.1:${port}/mesh/zhin/jsonrpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: 'x'.repeat(1_048_576) }),
    });
    expect(jsonRpcTooLarge.status).toBe(413);
    expect(await jsonRpcTooLarge.json()).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });

    const invalid = await fetch(`${endpoint}/v1/message:send`, {
      method: 'POST',
      headers,
      body: '{invalid',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Invalid JSON body' });

    const missing = await fetch(`${endpoint}/v1/tasks/missing`, { headers });
    expect(missing.status).toBe(404);
  });
});
