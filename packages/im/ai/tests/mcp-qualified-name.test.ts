import { describe, it, expect } from 'vitest';
import {
  formatMcpQualifiedToolName,
  parseMcpQualifiedToolName,
  parseLegacyMcpToolName,
  resolveMcpConnectionFromToolName,
} from '@zhin.js/ai/mcp-qualified-name';

describe('mcp-qualified-name', () => {
  it('formats and parses Eve-style names', () => {
    expect(formatMcpQualifiedToolName('filesystem', 'read_file')).toBe('filesystem__read_file');
    expect(parseMcpQualifiedToolName('filesystem__read_file')).toEqual({
      connection: 'filesystem',
      tool: 'read_file',
    });
  });

  it('parses legacy mcp_ names for migration', () => {
    expect(parseLegacyMcpToolName('mcp_fs_read')).toEqual({ connection: 'fs', tool: 'read' });
    expect(resolveMcpConnectionFromToolName('mcp_fs_read')).toBe('fs');
  });

  it('prefers source mcp: prefix', () => {
    expect(resolveMcpConnectionFromToolName('custom__tool', 'mcp:remote')).toBe('remote');
  });
});
