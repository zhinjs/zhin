import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { agentFeatureId, parseAgentPackage } from '@zhin.js/agent-feature';

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (relPath: string) => fs.readFileSync(path.join(exampleRoot, relPath), 'utf8');

const BOTS = ['planner', 'builder', 'reviewer'] as const;

describe('examples/multi-agent-room contract (ADR 0048 ai.venues + collaboration)', () => {
  it('declares 3 sandbox endpoints and a visible ai.venues entry in zhin.config.yml', () => {
    const configText = readText('zhin.config.yml');

    expect(configText).toContain('adapter-sandbox');
    expect(configText).toContain('name: planner-bot');
    expect(configText).toContain('name: builder-bot');
    expect(configText).toContain('name: reviewer-bot');
    expect(configText).toContain('id: product-room');
    expect(configText).toContain('adapter: sandbox');
    expect(configText).toContain('scene: group:product-room');
    expect(configText).toContain('mode: visible');
    expect(configText).toContain('entry: planner');
    expect(configText).toContain('planner: sandbox:planner-bot');
    expect(configText).toContain('builder: sandbox:builder-bot');
    expect(configText).toContain('reviewer: sandbox:reviewer-bot');
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
    const planText = readText('ai.plan.yml');
    for (const bot of BOTS) {
      expect(planText).toContain(`${bot}:`);
    }

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
