import { describe, it, expect } from 'vitest';
import { validateHomeMcpServer, listConfiguredMcpServerNames } from '../../src/assistant/home-mcp-bridge.js';

describe('Home MCP bridge', () => {
  it('validateHomeMcpServer 未注册时返回警告', () => {
    const msg = validateHomeMcpServer(
      { mcpServer: 'homeassistant' },
      { mcpServers: [{ name: 'filesystem', command: 'npx', args: [] }] },
    );
    expect(msg).toContain('homeassistant');
  });

  it('listConfiguredMcpServerNames 解析 ai.mcpServers', () => {
    const names = listConfiguredMcpServerNames({
      mcpServers: [
        { name: 'fs', transport: 'stdio', command: 'npx', args: [] },
        { name: 'ha', transport: 'stdio', command: 'npx', args: [] },
      ],
    });
    expect(names).toEqual(['fs', 'ha']);
  });
});
