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
});
