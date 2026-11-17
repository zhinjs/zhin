import { describe, expect, it, vi } from 'vitest';
import { McpClientConnection } from '../../src/mcp-client/index.js';
import { projectHostMcp } from '../../src/plugin-runtime/host-mcp-projection.js';

describe('configured MCP generation projection', () => {
  it('fails activation when a configured server is not ready', async () => {
    vi.spyOn(McpClientConnection.prototype, 'connect').mockResolvedValue({
      connected: false,
      tools: [],
      resources: [],
      prompts: [],
      error: 'not ready',
    });
    const projection = projectHostMcp({
      name: 'required', transport: 'streamable-http', url: 'https://mcp.example.test',
    });
    const client = await projection.definition.create({} as never);
    await expect(client.start?.(new AbortController().signal)).rejects.toThrow('not ready');
  });

  it('lists upstream tool names with boolean annotations as hints (ADR 0065 D1)', async () => {
    vi.spyOn(McpClientConnection.prototype, 'connect').mockResolvedValue({
      connected: true, tools: [], resources: [], prompts: [],
    });
    vi.spyOn(McpClientConnection.prototype, 'toolDefinitions', 'get').mockReturnValue([
      { name: 'list_issues', description: 'List', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        annotations: { readOnlyHint: true, openWorldHint: true, title: 'List issues' } },
      { name: 'create_issue', annotations: { readOnlyHint: 'true', destructiveHint: false } },
      { name: 'plain' },
    ]);
    const projection = projectHostMcp({ name: 'github', transport: 'streamable-http', url: 'https://mcp.example.test' });
    const client = await projection.definition.create({} as never);
    await client.start?.(new AbortController().signal);
    expect(await client.listTools()).toEqual([
      { name: 'list_issues', description: 'List', hints: { readOnly: true, openWorld: true },
        inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
      // A non-boolean readOnlyHint counts as "not annotated".
      { name: 'create_issue', hints: { destructive: false }, inputSchema: { type: 'object', properties: {} } },
      { name: 'plain', inputSchema: { type: 'object', properties: {} } },
    ]);
  });
});

describe('MCP bridge annotations', () => {
  it('keeps the upstream name and hints on bridged tools without relaxing readOnly', async () => {
    const { mcpToolToAgentTool } = await import('../../src/mcp-client/bridge.js');
    const tool = mcpToolToAgentTool({ name: 'list_issues', annotations: { readOnlyHint: true, destructiveHint: 'no' } }, 'github', async () => 'ok');
    expect(tool).toMatchObject({ name: 'github__list_issues', isReadOnly: false,
      mcpOrigin: { server: 'github', tool: 'list_issues', hints: { readOnly: true } } });
    expect(mcpToolToAgentTool({ name: 'x', annotations: [true] }, 'github', async () => 'ok').mcpOrigin).toEqual({ server: 'github', tool: 'x' });
  });
});
