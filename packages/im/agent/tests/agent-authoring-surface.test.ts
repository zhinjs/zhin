import { describe, it, expect } from 'vitest';
import {
  defineAgent,
  defineTool,
  namespaceAuthoringName,
  slotNameFromFile,
  isAuthoringDefinition,
  AUTHORING_KIND,
} from '../src/authoring/index.js';
import { z } from 'zod';
import { parseConfigWithZodSchema } from '../src/authoring/zod-schema.js';
import { bridgeAuthoringConnection } from '../src/authoring/bridge.js';
import { defineConnection } from '../src/authoring/define-connection.js';
import { resetAuthoringRegistrationForTests } from '../src/discovery/register-agent-surface.js';
import {
  collectPluginAgentRoots,
  resolveAuthoringImportPath,
} from '../src/discovery/agent-surface.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('authoring define* helpers', () => {
  it('defineAgent marks authoring kind', () => {
    const def = defineAgent({ description: 'test agent' });
    expect(isAuthoringDefinition(def, 'agent')).toBe(true);
    expect(def[AUTHORING_KIND]).toBe('agent');
  });

  it('defineTool wraps zod schema', () => {
    const def = defineTool({
      description: 'echo',
      inputSchema: z.object({ x: z.string() }),
      async execute({ x }) { return x; },
    });
    expect(isAuthoringDefinition(def, 'tool')).toBe(true);
  });
});

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
    expect(slotNameFromFile('/p/agent/tools/get_weather.ts')).toBe('get_weather');
  });
});

describe('connection schema bridge', () => {
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
    const parsed = parseConfigWithZodSchema(z.object({ token: z.string().min(1) }), {});
    expect(parsed.ok).toBe(false);
  });
});

describe('discoverWorkspaceAgents fractal', () => {
  it('discovers agents/<name>/ directories with instructions', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-agents-'));
    const researcher = path.join(tmp, 'agents', 'researcher');
    fs.mkdirSync(researcher, { recursive: true });
    fs.writeFileSync(
      path.join(researcher, 'agent.ts'),
      `const KIND = Symbol.for('zhin.authoring.kind');\nexport default { [KIND]: 'agent', description: 'Research specialist', role: 'researcher' };\n`,
    );
    fs.writeFileSync(path.join(researcher, 'instructions.md'), 'You research things.\n');
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const { discoverWorkspaceAgents } = await import('../src/discovery/agents.js');
      const metas = await discoverWorkspaceAgents();
      expect(metas.some((m) => m.name === 'researcher' && m.description.includes('Research'))).toBe(true);
    } finally {
      process.chdir(cwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('resetAuthoringRegistrationForTests', () => {
  it('clears registration sets', () => {
    expect(() => resetAuthoringRegistrationForTests()).not.toThrow();
  });
});

describe('resolveAuthoringImportPath', () => {
  it('prefers lib output when present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-pkg-'));
    const libTool = path.join(root, 'lib', 'agent', 'tools', 'sync.js');
    fs.mkdirSync(path.dirname(libTool), { recursive: true });
    fs.writeFileSync(libTool, 'export default {}');
    const srcTool = path.join(root, 'agent', 'tools', 'sync.ts');
    fs.mkdirSync(path.dirname(srcTool), { recursive: true });
    fs.writeFileSync(srcTool, 'export default {}');
    expect(resolveAuthoringImportPath(root, srcTool)).toBe(libTool);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
