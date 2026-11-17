import { describe, expect, it } from 'vitest';
import { McpClientConnection } from '@zhin.js/agent';
import { HostMcpStatusBoard } from '@zhin.js/agent/runtime';
import { describeAgentMcpServers, describeMcpServers } from '../../../src/instance/agent/host-installer.js';

describe('Agent ready log MCP wording (#1250 batch 28)', () => {
  it('uses the same states as the Console rows instead of bare configured names', () => {
    const status = new HostMcpStatusBoard();
    expect(describeMcpServers(status, [])).toBe('-');
    expect(describeMcpServers(status, ['github'])).toBe('github(待连接)');

    status.failed('github', { category: 'auth', message: 'HTTP 401', at: 1 });
    expect(describeMcpServers(status, ['github'])).toBe('github(连接失败)');

    const connection = new McpClientConnection({ name: 'docs', transport: 'stdio', command: 'docs-mcp' });
    Reflect.set(connection, 'state', { connected: true, tools: [], resources: [], prompts: [] });
    status.track('docs', connection);
    expect(describeMcpServers(status, ['github', 'docs'])).toBe('github(连接失败),docs(已连接)');
  });
});

describe('Agent ready log lists only bound MCP servers (#1250 第 41 批 mcp-connected-but-unbound)', () => {
  it('keeps servers the Agent does not bind out of `mcp:` and lists them as 未绑定', () => {
    const status = new HostMcpStatusBoard();
    // `ai.agents.zhin: {}`: github is configured (and would connect) but not bound to zhin.
    expect(describeAgentMcpServers(status, ['github'], [])).toBe('mcp: - | 未绑定: github(待连接)');

    const connection = new McpClientConnection({ name: 'docs', transport: 'stdio', command: 'docs-mcp' });
    Reflect.set(connection, 'state', { connected: true, tools: [], resources: [], prompts: [] });
    status.track('docs', connection);
    expect(describeAgentMcpServers(status, ['github', 'docs'], ['docs'])).toBe('mcp: docs(已连接) | 未绑定: github(待连接)');
    expect(describeAgentMcpServers(status, ['github', 'docs'], ['docs', 'github'])).toBe('mcp: docs(已连接),github(待连接)');
    expect(describeAgentMcpServers(status, [], [])).toBe('mcp: -');
  });
});
