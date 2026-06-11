import { describe, it, expect } from 'vitest';
import {
  formatAdaptersList,
  formatAgentsList,
  formatEndpointsList,
  formatCommandsList,
  formatMcpServersList,
  formatToolsList,
} from '../src/init/introspection-commands-format.js';

describe('introspection command formatters', () => {
  it('formatCommandsList', () => {
    const text = formatCommandsList([
      { pattern: '/endpoints', desc: 'Endpoint 列表' },
      { pattern: 'hello', desc: '打招呼' },
    ]);
    expect(text).toContain('/endpoints');
    expect(text).toContain('hello');
  });

  it('formatEndpointsList', () => {
    const text = formatEndpointsList([
      { adapter: 'icqq', name: '8596238', online: true },
      { adapter: 'qq', name: 'zhin2', online: false },
    ]);
    expect(text).toContain('icqq/8596238');
    expect(text).toContain('online');
    expect(text).toContain('offline');
  });

  it('formatAgentsList', () => {
    const text = formatAgentsList([
      {
        name: 'zhin',
        provider: 'openai-main',
        model: 'mimo-v2.5-pro',
        mcpServers: ['icqq'],
        hasAgentFile: true,
      },
    ]);
    expect(text).toContain('zhin');
    expect(text).toContain('mimo-v2.5-pro');
  });

  it('formatToolsList truncates long lists', () => {
    const tools = Array.from({ length: 60 }, (_, i) => ({
      name: `tool_${i}`,
      description: 'x',
    }));
    const text = formatToolsList(tools, 50);
    expect(text).toContain('还有 10 个');
  });

  it('formatMcpServersList', () => {
    const text = formatMcpServersList([
      { name: 'icqq', connected: true, toolCount: 12 },
    ]);
    expect(text).toContain('icqq');
    expect(text).toContain('connected');
  });

  it('formatAdaptersList empty', () => {
    expect(formatAdaptersList([])).toContain('暂无');
  });
});
