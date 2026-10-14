import { describe, it, expect } from 'vitest';
import {
  buildToolCatalog,
  discoverInCatalog,
  resolveDeferredApiTools,
} from '../../src/tool-catalog/tool-catalog.js';
import { resolveDeferredToolsConfig } from '../../src/tool-catalog/resolve-config.js';
import { DEFAULT_ALWAYS_LOADED_TOOLS } from '../../src/tool-catalog/types.js';
import type { AgentTool } from '@zhin.js/ai';

function makeTool(name: string, desc = ''): AgentTool {
  return {
    name,
    description: desc || name,
    parameters: { type: 'object', properties: {} },
    execute: async () => 'ok',
  };
}

describe('tool-catalog', () => {
  it('resolveDeferredApiTools returns alwaysLoaded + session loaded', () => {
    const tools = [
      makeTool('discover'),
      makeTool('load_tool'),
      makeTool('bash'),
      makeTool('read_file'),
    ];
    const always = new Set(['discover', 'load_tool']);
    const catalog = buildToolCatalog({ tools, alwaysLoaded: always });
    const api = resolveDeferredApiTools(catalog, always, ['bash']);
    expect(api.map(t => t.name).sort()).toEqual(['bash', 'discover', 'load_tool']);
  });

  it('discover kind=all with query returns bucketed results', () => {
    const catalog = buildToolCatalog({
      tools: [makeTool('deploy_tool', 'deploy application'), makeTool('discover')],
      alwaysLoaded: new Set(['discover']),
    });
    const results = discoverInCatalog({
      query: 'deploy',
      kind: 'all',
      topK: 5,
      catalog,
      skillRegistry: null,
    });
    expect(results.some(r => r.kind === 'tool' && r.name === 'deploy_tool')).toBe(true);
  });

  it('resolveDeferredToolsConfig uses deferredTools.alwaysLoadedTools', () => {
    const cfg = resolveDeferredToolsConfig({
      deferredTools: { alwaysLoadedTools: ['ask_user', 'spawn_task'] },
    });
    expect(cfg.alwaysLoadedTools).toContain('ask_user');
    expect(cfg.maxLoadedPerSession).toBe(12);
  });

  it('alwaysLoadedTools extends the default resident set (#740)', () => {
    const cfg = resolveDeferredToolsConfig({ deferredTools: { alwaysLoadedTools: ['probe_source', 'spawn_task'] } });
    expect(cfg.alwaysLoadedTools).toEqual([...new Set([...DEFAULT_ALWAYS_LOADED_TOOLS, 'probe_source'])]);
    expect(cfg.alwaysLoadedTools).toEqual(expect.arrayContaining(['discover', 'load_tool', 'load_skill', 'spawn_task']));
  });

  it("alwaysLoadedMode 'replace' opts out of the defaults (#740)", () => {
    const cfg = resolveDeferredToolsConfig({
      deferredTools: { alwaysLoadedTools: ['spawn_task'], alwaysLoadedMode: 'replace' },
    });
    expect(cfg.alwaysLoadedTools).toEqual(['spawn_task']);
    expect(resolveDeferredToolsConfig({ deferredTools: { alwaysLoadedMode: 'replace' } }).alwaysLoadedTools).toEqual([]);
  });

  it('no override keeps exactly the defaults', () => {
    expect(resolveDeferredToolsConfig({}).alwaysLoadedTools).toEqual([...DEFAULT_ALWAYS_LOADED_TOOLS]);
  });
});
