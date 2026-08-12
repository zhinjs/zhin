import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createHttpHost } from '@zhin.js/host-http';
import { installRuntimeMcp, type RuntimeMcpTool } from '../src/runtime.js';

const hosts: Array<ReturnType<typeof createHttpHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('Runtime MCP Host', () => {
  it('keeps the package root inert and exposes the Runtime API', async () => {
    const entry = await import('../src/index.js');

    expect(entry.installRuntimeMcp).toBe(installRuntimeMcp);
  });

  it('requires Bearer auth and executes snapshot-provided tools', async () => {
    const execute = vi.fn(async ({ value }: { value: string }) => `echo:${value}`);
    const tool: RuntimeMcpTool = {
      name: 'echo',
      description: 'Echo input',
      inputSchema: z.object({ value: z.string() }),
      execute: (input, context) => execute(input as { value: string }, context),
    };
    const { baseUrl } = await start([tool]);

    const denied = await mcpRequest(baseUrl, 'tools/list');
    expect(denied.status).toBe(401);

    const listed = await mcpRequest(baseUrl, 'tools/list', {}, 'test-token');
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain('"name":"echo"');
    expect(await mcpText(baseUrl, 'tools/call', {
      name: 'echo',
      arguments: { value: 'hello' },
    })).toContain('echo:hello');
    expect(execute).toHaveBeenCalledWith({ value: 'hello' }, expect.objectContaining({
      signal: expect.any(AbortSignal),
      principal: { subjectId: 'mcp-client', roles: ['authenticated'] },
    }));
  });

  it('surfaces denial from the canonical tool execution authority', async () => {
    const execute = vi.fn(async () => {
      throw new Error('approval required but ApprovalPort unavailable');
    });
    const { baseUrl } = await start([{
      name: 'dangerous',
      description: 'Requires approval',
      execute,
    }]);

    const body = await mcpText(baseUrl, 'tools/call', {
      name: 'dangerous',
      arguments: {},
    });
    expect(body).toContain('approval required');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('does not grant authenticated role for a bogus localhost Authorization header', async () => {
    const execute = vi.fn(async (
      _input: unknown,
      context: Parameters<RuntimeMcpTool['execute']>[1],
    ) => context.principal.roles.join(','));
    const { baseUrl } = await start([{
      name: 'identity',
      description: 'Return caller role',
      execute,
    }], true);
    const response = await mcpRequest(baseUrl, 'tools/call', {
      name: 'identity', arguments: {},
    }, 'bogus-token');

    expect(await response.text()).toContain('localhost');
    expect(execute).toHaveBeenCalledWith({}, expect.objectContaining({
      principal: { subjectId: 'mcp-client', roles: ['localhost'] },
    }));
  });

  it('uses the Host JSON parser limit and preserves JSON-RPC parse errors', async () => {
    const { baseUrl } = await start([]);
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ payload: 'x'.repeat(1_048_576) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });

    const invalid = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: '{invalid',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: -32700 } });
  });
});

async function start(
  tools: readonly RuntimeMcpTool[],
  allowUnauthenticatedLocalhost = false,
): Promise<{ baseUrl: string }> {
  const host = createHttpHost({ host: '127.0.0.1', port: 0 });
  hosts.push(host);
  installRuntimeMcp({
    http: host,
    config: { token: 'test-token', allowUnauthenticatedLocalhost },
    tools: { withTools: (_context, operation) => operation(tools) },
  });
  const address = await host.listen();
  return { baseUrl: `http://127.0.0.1:${address.port}/mcp` };
}

async function mcpText(
  url: string,
  method: string,
  params: Record<string, unknown>,
): Promise<string> {
  const response = await mcpRequest(url, method, params, 'test-token');
  expect(response.status).toBe(200);
  return response.text();
}

function mcpRequest(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  token?: string,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}
