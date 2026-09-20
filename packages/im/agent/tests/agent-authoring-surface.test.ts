import { describe, it, expect } from 'vitest';
import {
  namespaceAuthoringName,
  slotNameFromFile,
} from '../src/authoring/index.js';
import { z } from 'zod';
import { bridgeAuthoringConnection } from '../src/authoring/bridge.js';
import { defineConnection } from '../src/authoring/define-connection.js';
import {
  discoverPluginAgentSurface,
  resolveAuthoringImportPath,
} from '../src/discovery/agent-surface.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('namespaceAuthoringName', () => {
  it('prefixes plugin slot names', () => {
    expect(namespaceAuthoringName('lottery', 'sync')).toBe('lottery_sync');
  });

  it('allows bare workspace names', () => {
    expect(namespaceAuthoringName('workspace', 'researcher', true)).toBe('researcher');
  });
});

describe('slotNameFromFile', () => {
  it('strips extension', () => {
    expect(slotNameFromFile('/p/agent/tools/$get_weather.ts')).toBe('get_weather');
  });
});

describe('agent authoring entry discovery', () => {
  it('leaves Agent Tool discovery to the Tool Feature', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-agent-surface-'));
    const tools = path.join(root, 'agent', 'tools');
    fs.mkdirSync(tools, { recursive: true });
    fs.writeFileSync(path.join(tools, 'helper.js'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(tools, '$lookup.js'), [
      "import { value } from './helper.js';",
      "export default { description: 'lookup', execute: () => value };",
      '',
    ].join('\n'));
    try {
      const surface = await discoverPluginAgentSurface({
        pluginName: 'fixture',
        packageRoot: root,
        agentDir: path.join(root, 'agent'),
        evalsDir: path.join(root, 'evals'),
      });
      expect(surface).not.toHaveProperty('tools');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('connection schema bridge', () => {
  it('requires a Zod 4 object schema', () => {
    expect(() => defineConnection({
      description: 'Invalid connection',
      transport: 'stdio',
      configSchema: z.string() as never,
      buildEntry: () => ({}),
    })).toThrow('Connection configSchema must be a Zod 4 object schema');
  });

  it('validates config against zod schema', () => {
    const def = defineConnection({
      description: 'GitHub MCP',
      transport: 'streamable-http',
      configSchema: z.object({ token: z.string().min(1) }),
      buildEntry: (cfg) => ({ headers: { Authorization: `Bearer ${cfg.token}` } }),
      url: 'https://example.com/mcp',
    });
    const bridged = bridgeAuthoringConnection(
      { runtimeName: 'lottery_github', slotName: 'github', pluginName: 'lottery', definition: def },
      { token: 'abc' },
    );
    expect(bridged.ok).toBe(true);
    if (bridged.ok) {
      expect(bridged.entry.headers?.Authorization).toBe('Bearer abc');
    }
  });

  it('rejects invalid config', () => {
    const definition = defineConnection({
      description: 'GitHub MCP',
      transport: 'streamable-http',
      configSchema: z.object({ token: z.string().min(1) }),
      buildEntry: () => ({ url: 'https://example.com/mcp' }),
    });
    const bridged = bridgeAuthoringConnection(
      { runtimeName: 'lottery_github', slotName: 'github', pluginName: 'lottery', definition },
      {},
    );
    expect(bridged.ok).toBe(false);
  });
});

describe('discoverWorkspaceAgents', () => {
  it('discovers canonical agents/<name>/ packages', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-agents-'));
    const researcher = path.join(tmp, 'agents', 'researcher');
    fs.mkdirSync(researcher, { recursive: true });
    fs.writeFileSync(path.join(researcher, 'agent.json'), JSON.stringify({
      name: 'Researcher',
      version: '1.0.0',
      description: 'Research specialist',
      trigger_rules: { file_patterns: [], keywords: ['research'] },
      entry_points: ['system.md', 'boundaries.md', 'conventions.md'],
      role: 'researcher',
    }));
    fs.writeFileSync(path.join(researcher, 'system.md'), 'You research things.\n');
    fs.writeFileSync(path.join(researcher, 'boundaries.md'), 'Stay in scope.\n');
    fs.writeFileSync(path.join(researcher, 'conventions.md'), 'Follow AGENTS.md.\n');
    try {
      const { discoverWorkspaceAgents } = await import('../src/discovery/agents.js');
      const cwd = process.cwd();
      const metas = await discoverWorkspaceAgents(tmp);
      expect(metas.some((m) => m.name === 'researcher' && m.description.includes('Research'))).toBe(true);
      expect(metas[0]?.systemPrompt).toContain('system.md');
      expect(process.cwd()).toBe(cwd);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('resolveAuthoringImportPath', () => {
  it('prefers lib output when present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-pkg-'));
    const libTool = path.join(root, 'lib', 'agent', 'tools', '$sync.js');
    fs.mkdirSync(path.dirname(libTool), { recursive: true });
    fs.writeFileSync(libTool, 'export default {}');
    const srcTool = path.join(root, 'agent', 'tools', '$sync.ts');
    fs.mkdirSync(path.dirname(srcTool), { recursive: true });
    fs.writeFileSync(srcTool, 'export default {}');
    expect(resolveAuthoringImportPath(root, srcTool)).toBe(libTool);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
