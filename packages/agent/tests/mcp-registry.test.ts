import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import { collectRuntimeTools } from '../src/zhin-agent/tool-runtime.js';
import { DEFAULT_CONFIG } from '../src/zhin-agent/config.js';

const mockTool: AgentTool = {
  name: 'mcp_fs_read',
  description: 'read',
  parameters: { type: 'object', properties: {} },
  execute: async () => 'ok',
};

const connectImpl = vi.hoisted(() =>
  vi.fn(async (_entry: { name: string }) => ({
    isConnected: true,
    tools: [mockTool],
    resources: [] as [],
    prompts: [] as [],
  })),
);

vi.mock('../src/mcp-client/index.js', () => ({
  McpClientManager: vi.fn(function McpClientManager() {
    return {
      connect: (entry: { name: string }) => connectImpl(entry),
      disconnect: vi.fn(),
      disconnectAll: vi.fn(),
    };
  }),
}));

type McpRegistryCtor = typeof import('../src/orchestrator/mcp-registry.js').McpRegistry;
let McpRegistry: McpRegistryCtor;

describe('McpRegistry', () => {
  beforeEach(async () => {
    connectImpl.mockReset();
    connectImpl.mockImplementation(async () => ({
      isConnected: true,
      tools: [mockTool],
      resources: [],
      prompts: [],
    }));
    vi.resetModules();
    ({ McpRegistry } = await import('../src/orchestrator/mcp-registry.js'));
  });

  it('connect delegates to McpClientManager and exposes tools', async () => {
    const registry = new McpRegistry();
    registry.add(
      { name: 'fs', transport: 'stdio', command: 'echo', args: [] },
      {},
      'test',
    );
    await registry.connect('fs');
    expect(registry.isConnected('fs')).toBe(true);
    expect(registry.getAllMcpTools().map(t => t.name)).toContain('mcp_fs_read');
  });

  it('ensureConnected continues when one server fails', async () => {
    connectImpl.mockImplementation(async (entry) => {
      if (entry.name === 'bad') {
        throw new Error('spawn failed');
      }
      return { isConnected: true, tools: [mockTool], resources: [], prompts: [] };
    });
    const registry = new McpRegistry();
    registry.add({ name: 'bad', transport: 'stdio', command: 'false' }, {}, 'test');
    registry.add({ name: 'good', transport: 'stdio', command: 'echo' }, {}, 'test');
    await registry.ensureConnected();
    expect(registry.isConnected('good')).toBe(true);
    expect(registry.isConnected('bad')).toBe(false);
    expect(registry.getAllMcpTools().length).toBeGreaterThan(0);
  });

  it('SDK missing yields disconnected without throwing from ensureConnected', async () => {
    connectImpl.mockImplementation(async () => ({
      isConnected: false,
      tools: [],
      resources: [],
      prompts: [],
    }));
    const registry = new McpRegistry();
    registry.add({ name: 'noop', transport: 'stdio', command: 'true' }, {}, 'test');
    await expect(registry.ensureConnected()).resolves.toBeUndefined();
    expect(registry.getAllMcpTools()).toHaveLength(0);
  });
});

describe('collectRuntimeTools MCP merge', () => {
  it('merges mcpTools into runtime tool list', () => {
    const tools = collectRuntimeTools({
      content: 'hello',
      context: { userId: 'u1', platform: 'test' },
      externalTools: [],
      config: DEFAULT_CONFIG as Required<typeof DEFAULT_CONFIG>,
      skillRegistry: null,
      externalRegistered: new Map(),
      sessionId: 's1',
      userId: 'u1',
      memory: { getHistory: async () => [] } as any,
      userProfiles: { buildProfileSummary: async () => '' } as any,
      subagentManager: null,
      mcpTools: [mockTool],
    });
    expect(tools.some(t => t.name === 'mcp_fs_read')).toBe(true);
  });

  it('skips MCP tools that conflict with reserved names', () => {
    const tools = collectRuntimeTools({
      content: 'hello',
      context: { userId: 'u1', platform: 'test' },
      externalTools: [],
      config: DEFAULT_CONFIG as Required<typeof DEFAULT_CONFIG>,
      skillRegistry: null,
      externalRegistered: new Map(),
      sessionId: 's1',
      userId: 'u1',
      memory: { getHistory: async () => [] } as any,
      userProfiles: { buildProfileSummary: async () => '' } as any,
      subagentManager: null,
      mcpTools: [{
        name: 'bash',
        description: 'fake',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'x',
      }],
    });
    expect(tools.some(t => t.name === 'bash' && t.kind === 'mcp')).toBe(false);
  });
});
