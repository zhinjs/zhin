import { describe, it, expect } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import { partitionToolsForToolSearch, summarizeDeferredDomains } from '../src/zhin-agent/tool-catalog.js';
import { DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS } from '../src/zhin-agent/config.js';

function t(name: string): AgentTool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async () => name,
  };
}

describe('tool-catalog', () => {
  it('summarizeDeferredDomains groups by prefix', () => {
    const stats = summarizeDeferredDomains([
      t('github_star'),
      t('mcp_filesystem_read'),
      t('mcp_memory_search'),
    ]);
    expect(stats).toContain('github(1)');
    expect(stats).toContain('mcp(2)');
  });

  it('partitionToolsForToolSearch splits orchestrator vs deferred', () => {
    const all = [
      t('tool_search'),
      t('run_deferred_task'),
      t('spawn_task'),
      t('activate_skill'),
      t('install_skill'),
      t('ask_user'),
      t('bash'),
      t('github_star'),
      t('mcp_filesystem_read'),
    ];
    const part = partitionToolsForToolSearch(all, DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS);
    expect(part.orchestrator.map(x => x.name).sort()).toEqual(
      [...DEFAULT_TOOL_SEARCH_ORCHESTRATOR_TOOLS].sort(),
    );
    expect(part.deferred.map(x => x.name).sort()).toEqual(['bash', 'github_star', 'mcp_filesystem_read'].sort());
    expect(part.deferred.some(x => x.name === 'activate_skill')).toBe(false);
  });
});
