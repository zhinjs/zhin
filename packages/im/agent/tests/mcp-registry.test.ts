import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryImTranscriptStore, type AgentTool } from '@zhin.js/ai';

import { collectRuntimeTools } from '../src/tool/runtime.js';
import { DEFAULT_CONFIG } from '../src/config/index.js';
import { mockCommMessage } from './helpers/mock-comm-message.js';

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

const isHealthyImpl = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../src/mcp-client/index.js', () => ({
  McpClientManager: vi.fn(function McpClientManager() {
    return {
      connect: (entry: { name: string }) => connectImpl(entry),
      disconnect: vi.fn(),
      disconnectAll: vi.fn(),
      isHealthy: (_name: string) => isHealthyImpl(),
    };
  }),
}));

type McpRegistryCtor = typeof import('../src/orchestrator/mcp-registry.js').McpRegistry;
let McpRegistry: McpRegistryCtor;

describe('McpRegistry', () => {
  beforeEach(async () => {
    connectImpl.mockReset();
    isHealthyImpl.mockReset();
    isHealthyImpl.mockResolvedValue(true);
    connectImpl.mockImplementation(async () => ({
      isConnected: true,
      tools: [mockTool],
      resources: [],
      prompts: [],
    }));
    vi.resetModules();
    ({ McpRegistry } = await import('../src/orchestrator/mcp-registry.js'));
  });

  it('reconnects when cached connection fails health check', async () => {
    const registry = new McpRegistry();
    registry.add(
      { name: 'fs', transport: 'stdio', command: 'echo', args: [] },
      {},
      'test',
    );
    await registry.connect('fs');
    expect(connectImpl).toHaveBeenCalledTimes(1);
    isHealthyImpl.mockResolvedValueOnce(false);
    await registry.connect('fs');
    expect(connectImpl).toHaveBeenCalledTimes(2);
    expect(registry.getAllMcpTools().map(t => t.name)).toContain('mcp_fs_read');
  });

  it('ensureConnected replaces stale connections', async () => {
    const registry = new McpRegistry();
    registry.add({ name: 'fs', transport: 'stdio', command: 'echo' }, {}, 'test');
    await registry.connect('fs');
    isHealthyImpl.mockResolvedValue(false);
    await registry.ensureConnected();
    expect(connectImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
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

  it('ensureConnected emits lifecycle events per server', async () => {
    connectImpl.mockImplementation(async (entry) => {
      if (entry.name === 'bad') throw new Error('boom');
      return { isConnected: true, tools: [mockTool], resources: [], prompts: [] };
    });
    const registry = new McpRegistry();
    const onEvent = vi.fn();
    registry.add({ name: 'good', transport: 'stdio', command: 'echo' }, {}, 'test');
    registry.add({ name: 'bad', transport: 'stdio', command: 'false' }, {}, 'test');

    await registry.ensureConnected(onEvent);

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'start', serverName: 'good' }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'finish', serverName: 'good', connected: true }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'start', serverName: 'bad' }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'error', serverName: 'bad', error: 'boom' }));
  });
});

describe('collectRuntimeTools MCP merge', () => {
  it('merges mcpTools into runtime tool list', () => {
    const tools = collectRuntimeTools({
      content: 'hello',
      commMessage: mockCommMessage({ adapter: 'test', senderId: 'u1' }),
      externalTools: [],
      config: DEFAULT_CONFIG as Required<typeof DEFAULT_CONFIG>,
      skillRegistry: null,
      externalRegistered: new Map(),
      sessionId: 's1',
      userId: 'u1',
      imTranscriptStore: new MemoryImTranscriptStore(),
      userProfiles: { buildProfileSummary: async () => '' } as any,
      mcpTools: [mockTool],
    });
    expect(tools.some(t => t.name === 'mcp_fs_read')).toBe(true);
  });

  it('skips MCP tools that conflict with reserved names', () => {
    const tools = collectRuntimeTools({
      content: 'hello',
      commMessage: mockCommMessage({ adapter: 'test', senderId: 'u1' }),
      externalTools: [],
      config: DEFAULT_CONFIG as Required<typeof DEFAULT_CONFIG>,
      skillRegistry: null,
      externalRegistered: new Map(),
      sessionId: 's1',
      userId: 'u1',
      imTranscriptStore: new MemoryImTranscriptStore(),
      userProfiles: { buildProfileSummary: async () => '' } as any,
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
