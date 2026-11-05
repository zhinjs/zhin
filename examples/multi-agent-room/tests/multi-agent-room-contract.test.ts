import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { agentFeatureId, parseAgentPackage } from '@zhin.js/agent-feature';

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (relPath: string) => fs.readFileSync(path.join(exampleRoot, relPath), 'utf8');
const readYaml = <T = Record<string, unknown>>(relPath: string) => yaml.load(readText(relPath)) as T;

const BOTS = ['planner', 'builder', 'reviewer'] as const;

describe('examples/multi-agent-room contract (ADR 0048 ai.venues + collaboration)', () => {
  it('declares 3 sandbox endpoints and a visible ai.venues entry in zhin.config.yml', () => {
    const config = readYaml<{
      plugins?: string[];
      sandbox?: { endpoints?: Array<{ context?: string; name?: string; capabilities?: string[] }> };
      ai?: {
        enabled?: boolean;
        venues?: Array<{
          id?: string;
          adapter?: string;
          scene?: string;
          mode?: string;
          entry?: string;
          participants?: Record<string, string>;
        }>;
      };
    }>('zhin.config.yml');

    expect(config.plugins).toContain('adapter-sandbox');
    expect(config.sandbox?.endpoints?.map((e) => e.name)).toEqual([
      'planner-bot',
      'builder-bot',
      'reviewer-bot',
    ]);
    for (const endpoint of config.sandbox?.endpoints ?? []) {
      expect(endpoint.context).toBe('sandbox');
      expect(endpoint.capabilities).toEqual(expect.arrayContaining(['inbound', 'outbound']));
    }

    expect(config.ai?.enabled).toBe(true);
    expect(config.ai?.venues).toEqual([
      {
        id: 'product-room',
        adapter: 'sandbox',
        scene: 'group:product-room',
        mode: 'visible',
        entry: 'planner',
        participants: {
          planner: 'sandbox:planner-bot',
          builder: 'sandbox:builder-bot',
          reviewer: 'sandbox:reviewer-bot',
        },
      },
    ]);
  });

  it('ships valid agent packages for planner, builder, and reviewer with collaboration rules', () => {
    for (const bot of BOTS) {
      const dir = path.join(exampleRoot, 'agents', bot);
      const pkg = parseAgentPackage(
        {
          manifest: JSON.parse(readText(`agents/${bot}/agent.json`)),
          files: {
            'system.md': readText(`agents/${bot}/system.md`),
            'boundaries.md': readText(`agents/${bot}/boundaries.md`),
            'conventions.md': readText(`agents/${bot}/conventions.md`),
          },
          workflows: [],
          knowledge: [],
          privateToolNames: [],
          privateSkillNames: [],
        },
        { owner: rootPluginId(), feature: agentFeatureId, localName: bot, source: dir },
      );
      expect(pkg.name).toBe(bot);
      expect(pkg.collaboration).toBeDefined();
      expect(pkg.collaboration?.contacts?.length).toBeGreaterThan(0);
      expect(pkg.collaboration?.acceptsFrom).toContain('human');
      expect(pkg.collaboration?.budget?.modelCalls).toBeGreaterThan(0);
      expect(pkg.instructions).toMatch(/board_read|board_write/);
    }
  });

  it('maps all 3 agents in ai.plan.yml and does not depend on @zhin.js/workroom', () => {
    const plan = readYaml<{
      purposes?: { agents?: Record<string, { provider?: string; model?: string }> };
    }>('ai.plan.yml');
    expect(Object.keys(plan.purposes?.agents ?? {}).sort()).toEqual([...BOTS].sort());

    const manifest = JSON.parse(readText('package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.['@zhin.js/workroom']).toBeUndefined();
    expect(manifest.dependencies?.['@zhin.js/agent']).toBe('workspace:*');
  });

  it('documents ai.venues, collaboration tools, board, and zhin trace in README.md', () => {
    const readme = readText('README.md');
    expect(readme).toContain('ai.venues');
    expect(readme).toContain('board_write');
    expect(readme).toContain('board_read');
    expect(readme).toContain('zhin trace');
  });
});
