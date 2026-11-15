import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClientConnection } from '../../src/mcp-client/index.js';
import { McpRegistry } from '../../src/resource-hub/mcp-registry.js';
import { agentHostToken } from '../../src/plugin-runtime/index.js';
import { AgentHostPublicationCoordinator } from '../../src/plugin-runtime/host/publication-coordinator.js';
import { HostMcpStatusBoard } from '../../src/plugin-runtime/host-mcp-status.js';
import { projectHostMcp } from '../../src/plugin-runtime/host-mcp-projection.js';
import type { AgentHostPort } from '../../src/plugin-runtime/agent-host-port.js';

const github = { name: 'github', transport: 'streamable-http' as const, url: 'https://mcp.example.test' };
const docs = { name: 'docs', transport: 'stdio' as const, command: 'docs-mcp' };

afterEach(() => { vi.restoreAllMocks(); });

function publish(status: HostMcpStatusBoard, entries = [github, docs]): AgentHostPort {
  const provided = new Map<string, unknown>();
  const resources = { provide: (token: { id: string }, value: unknown) => { provided.set(token.id, value); } };
  new AgentHostPublicationCoordinator({
    projectRoot: '/tmp/zhin-publication-mcp',
    signal: new AbortController().signal,
    resources: resources as never,
    processRuntime: {} as never,
    agent: {
      service: {},
      composition: {},
      traceRuntime: {},
      schedule: {},
      sessionTreeRuntime: {},
      // The Agent's own registry: configured servers never enter it under the Plugin Runtime.
      agent: { resourceHub: { mcps: new McpRegistry() } },
      listBindings: () => [],
    } as never,
    bootstrapText: '',
    mcp: { entries, status },
  });
  return provided.get(agentHostToken.id) as AgentHostPort;
}

describe('Agent Host MCP introspection (#1250 batch 28)', () => {
  it('lists the configured servers from their generation clients, not the empty registry', async () => {
    vi.spyOn(McpClientConnection.prototype, 'connect').mockImplementation(async function (this: McpClientConnection) {
      const state = { connected: true, tools: [{ name: 'search' } as never, { name: 'issue' } as never], resources: [], prompts: [] };
      Reflect.set(this, 'state', state);
      return state;
    });
    const status = new HostMcpStatusBoard();
    const host = publish(status);
    // Before activation: both configured, neither connected nor failed (pending first connect).
    expect(host.introspection.listMcpServers()).toEqual([
      { name: 'github', connected: false, toolCount: 0 },
      { name: 'docs', connected: false, toolCount: 0 },
    ]);

    const client = await projectHostMcp(github, status).definition.create({} as never);
    await client.start?.(new AbortController().signal);
    expect(host.introspection.listMcpServers()).toEqual([
      { name: 'github', connected: true, toolCount: 2 },
      { name: 'docs', connected: false, toolCount: 0 },
    ]);
  });

  it('tests a configured server on request and refuses unknown names', async () => {
    const status = new HostMcpStatusBoard();
    const probe = vi.spyOn(status, 'probe').mockResolvedValue({ ok: true, name: 'docs', toolCount: 4, durationMs: 3 });
    const host = publish(status);
    await expect(host.introspection.testMcpServer?.('docs')).resolves.toEqual({ ok: true, name: 'docs', toolCount: 4, durationMs: 3 });
    expect(probe).toHaveBeenCalledWith(docs);
    await expect(host.introspection.testMcpServer?.('unknown')).resolves.toBeUndefined();
  });
});
