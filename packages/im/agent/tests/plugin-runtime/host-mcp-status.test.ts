import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClientConnection } from '../../src/mcp-client/index.js';
import { McpConnectionError } from '../../src/mcp-client/failure.js';
import { projectHostMcp } from '../../src/plugin-runtime/host-mcp-projection.js';
import { HostMcpStatusBoard, type HostMcpStatusEvent } from '../../src/plugin-runtime/host-mcp-status.js';

const entry = { name: 'github', transport: 'streamable-http' as const, url: 'https://mcp.example.test' };
const tool = { name: 'search', description: 'Search', parameters: { type: 'object', properties: {} } };

/** Stands in for a server that accepts the connection and offers one tool. */
function connectSucceeds() {
  return vi.spyOn(McpClientConnection.prototype, 'connect').mockImplementation(async function (this: McpClientConnection) {
    const state = { connected: true, tools: [tool as never], resources: [], prompts: [] };
    Reflect.set(this, 'state', state);
    return state;
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('configured MCP status (#1250 mcp-status-not-loaded-contradicts-agent)', () => {
  it('reports a configured server the generation connected as connected, with its tools', async () => {
    connectSucceeds();
    const events: HostMcpStatusEvent[] = [];
    const status = new HostMcpStatusBoard({ onEvent: event => events.push(event) });
    // Before the generation is activated: configured, not connected yet, no failure (pending first connect).
    expect(status.summary('github')).toEqual({ name: 'github', connected: false, toolCount: 0 });

    const client = await projectHostMcp(entry, status).definition.create({} as never);
    await client.start?.(new AbortController().signal);

    expect(status.summary('github')).toEqual({ name: 'github', connected: true, toolCount: 1 });
    expect(events.map(event => event.type)).toEqual(['connecting', 'connected']);

    await client.stop?.();
    expect(status.summary('github')).toEqual({ name: 'github', connected: false, toolCount: 0 });
  });

  it('records the classified reason when the connect fails, and clears it after a later success', async () => {
    const failure = { category: 'auth' as const, message: 'HTTP 401 Unauthorized', at: 1 };
    const connect = vi.spyOn(McpClientConnection.prototype, 'connect')
      .mockRejectedValueOnce(new McpConnectionError(failure, new Error('401')));
    const status = new HostMcpStatusBoard();

    const failing = await projectHostMcp(entry, status).definition.create({} as never);
    await expect(failing.start?.(new AbortController().signal)).rejects.toThrow('401');
    expect(status.summary('github')).toEqual({ name: 'github', connected: false, toolCount: 0, lastError: failure });

    connect.mockRestore();
    connectSucceeds();
    const next = await projectHostMcp(entry, status).definition.create({} as never);
    await next.start?.(new AbortController().signal);
    expect(status.summary('github')).toEqual({ name: 'github', connected: true, toolCount: 1 });
  });

  it('keeps the old generation connected while a candidate fails', async () => {
    connectSucceeds();
    const status = new HostMcpStatusBoard();
    const current = await projectHostMcp(entry, status).definition.create({} as never);
    await current.start?.(new AbortController().signal);

    vi.restoreAllMocks();
    vi.spyOn(McpClientConnection.prototype, 'connect').mockResolvedValue({ connected: false, tools: [], resources: [], prompts: [], error: 'not ready' });
    const candidate = await projectHostMcp(entry, status).definition.create({} as never);
    await expect(candidate.start?.(new AbortController().signal)).rejects.toThrow('not ready');

    expect(status.summary('github')).toMatchObject({ connected: true, toolCount: 1 });
  });

  it('does not record a cancelled generation as a failed connect', async () => {
    vi.spyOn(McpClientConnection.prototype, 'connect').mockReturnValue(new Promise(() => undefined));
    const status = new HostMcpStatusBoard();
    const client = await projectHostMcp(entry, status).definition.create({} as never);
    const controller = new AbortController();
    const started = client.start?.(controller.signal);
    controller.abort(new Error('generation cancelled'));
    await expect(started).rejects.toThrow('generation cancelled');
    expect(status.summary('github')).toEqual({ name: 'github', connected: false, toolCount: 0 });
  });

  it('probes with a throw-away client and leaves the recorded state alone', async () => {
    connectSucceeds();
    const disconnect = vi.spyOn(McpClientConnection.prototype, 'disconnect');
    const status = new HostMcpStatusBoard();

    await expect(status.probe(entry)).resolves.toMatchObject({ ok: true, name: 'github', toolCount: 1 });
    expect(disconnect).toHaveBeenCalled();
    expect(status.summary('github')).toEqual({ name: 'github', connected: false, toolCount: 0 });
  });

  it('reports a probe failure or timeout with its reason', async () => {
    const failure = { category: 'network' as const, message: 'ECONNREFUSED', at: 1 };
    vi.spyOn(McpClientConnection.prototype, 'connect').mockRejectedValueOnce(new McpConnectionError(failure, new Error('refused')));
    const status = new HostMcpStatusBoard();
    await expect(status.probe(entry)).resolves.toMatchObject({ ok: false, failure });

    vi.spyOn(McpClientConnection.prototype, 'connect').mockReturnValue(new Promise(() => undefined));
    await expect(status.probe(entry, 20)).resolves.toMatchObject({ ok: false, failure: { category: 'timeout' } });
  });
});
