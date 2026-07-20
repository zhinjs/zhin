import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createHttpHost } from '@zhin.js/host-http';
import { installRuntimeMcp, type RuntimeMcpTool } from '../src/runtime.js';

const hosts: Array<ReturnType<typeof createHttpHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('Runtime MCP Host', () => {
  it('requires Bearer auth and executes snapshot-provided tools', async () => {
    const execute = vi.fn(async ({ value }: { value: string }) => `echo:${value}`);
    const tool: RuntimeMcpTool = {
      name: 'echo',
      description: 'Echo input',
      inputSchema: z.object({ value: z.string() }),
      approval: 'never',
      execute: (input) => execute(input as { value: string }),
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
    expect(execute).toHaveBeenCalledWith({ value: 'hello' });
  });

  it('does not execute approval-gated tools unless explicitly enabled', async () => {
    const execute = vi.fn(async () => 'unsafe');
    const { baseUrl } = await start([{
      name: 'dangerous',
      description: 'Requires approval',
      approval: 'always',
      execute,
    }]);

    const body = await mcpText(baseUrl, 'tools/call', {
      name: 'dangerous',
      arguments: {},
    });
    expect(body).toContain('requires approval');
    expect(execute).not.toHaveBeenCalled();
  });
});

async function start(tools: readonly RuntimeMcpTool[]): Promise<{ baseUrl: string }> {
  const host = createHttpHost({ host: '127.0.0.1', port: 0 });
  hosts.push(host);
  installRuntimeMcp({
    http: host,
    config: { token: 'test-token', allowUnauthenticatedLocalhost: false },
    tools: { withTools: (operation) => operation(tools) },
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
