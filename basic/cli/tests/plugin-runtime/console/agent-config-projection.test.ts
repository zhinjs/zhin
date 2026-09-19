import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentConfigProjection } from '../../../src/plugin-runtime/console/agent-config-projection.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AgentConfigProjection', () => {
  it('projects bindings and MCP declarations from the persisted project config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-agent-config-projection-'));
    roots.push(root);
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({
      ai: {
        agents: {
          zhin: {
            provider: 'openai',
            model: 'gpt-5',
            nickname: 'Zhin',
            mcpServers: ['docs'],
          },
        },
        mcpServers: [{ name: 'docs', transport: 'stdio' }],
      },
    }));

    const projection = new AgentConfigProjection(root);
    expect(projection.listBindings()).toEqual([{
      name: 'zhin',
      provider: 'openai',
      model: 'gpt-5',
      mcpServers: ['docs'],
      hasAgentFile: false,
    }]);
    expect(projection.listMcpServers()).toEqual([{ name: 'docs', transport: 'stdio' }]);
  });

  it('returns empty projections when the project has no readable config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-agent-config-projection-empty-'));
    roots.push(root);
    const projection = new AgentConfigProjection(root);
    expect(projection.listBindings()).toEqual([]);
    expect(projection.listMcpServers()).toEqual([]);
  });
});
