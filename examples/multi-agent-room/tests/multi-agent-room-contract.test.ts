import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { agentFeatureId, parseAgentPackage } from '@zhin.js/agent-feature';
import { parse } from 'yaml';
import { validateModelRuntimeConfig } from '../../../packages/im/agent/src/config/index.js';
import { resolveAgentHostVenues } from '../../../packages/im/agent/src/plugin-runtime/host/config.js';
import { readApplicationPluginDeclaration } from '../../../packages/im/runtime/src/application-plugin-declaration.js';
import { HOST_CONFIG_SCHEMA, validatePluginConfigSchema } from '../../../packages/im/runtime/src/config-composer.js';
import { parsePackageJson } from '../../../packages/im/runtime/src/manifest.js';
import { reviewAIPlan } from '../../../tests/helpers/review-ai-plan.js';

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (relPath: string) => fs.readFileSync(path.join(exampleRoot, relPath), 'utf8');

const BOTS = ['planner', 'builder', 'reviewer'] as const;

describe('examples/multi-agent-room contract (ADR 0048 ai.venues + collaboration)', () => {
  it('declares 3 sandbox endpoints and a visible ai.venues entry in zhin.config.yml', () => {
    const config = parse(readText('zhin.config.yml')) as Record<string, any>;

    // Real application protocol: configVersion 2 + alias → package map + top-level instance block.
    expect(readApplicationPluginDeclaration(config).instances).toEqual([
      { instanceKey: 'sandbox', package: '@zhin.js/adapter-sandbox', enabled: true },
    ]);
    const host = Object.fromEntries(Object.entries(config)
      .filter(([key]) => Object.hasOwn(HOST_CONFIG_SCHEMA.properties, key)));
    expect(validatePluginConfigSchema(HOST_CONFIG_SCHEMA, host)).toEqual([]);
    const sandboxSchema = JSON.parse(fs.readFileSync(
      path.join(exampleRoot, '../../plugins/adapters/sandbox/schema.json'), 'utf8'));
    expect(validatePluginConfigSchema(sandboxSchema, config.sandbox)).toEqual([]);
    expect(validateModelRuntimeConfig(config.ai, 'host:example')).toEqual([]);

    const [venue, ...rest] = resolveAgentHostVenues(config.ai);
    expect(rest).toEqual([]);
    expect(venue).toMatchObject({
      id: 'product-room',
      conversation: { platform: 'sandbox', sceneType: 'group', sceneId: 'product-room' },
      visibility: 'visible',
      entry: 'planner',
    });
    expect(venue.members.map(member => member.agent)).toEqual([...BOTS]);
    // Every member speaks through a Sandbox Endpoint that the instance actually declares.
    const endpointIds = config.sandbox.endpoints.map((endpoint: { id: string }) => endpoint.id);
    expect(venue.members.map(member => member.botEndpoint)).toEqual(endpointIds);
  });

  it('has a complete Plugin Runtime manifest', () => {
    const parsed = parsePackageJson(JSON.parse(readText('package.json')), 'package.json');
    expect(parsed.zhin).toMatchObject({
      protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted', plugins: [],
    });
    expect(parsed.zhin && 'features' in parsed.zhin ? parsed.zhin.features.map(feature => feature.package) : [])
      .toEqual(['@zhin.js/agent-feature']);
    expect(parsed.scripts?.dev).toBe('zhin start --foreground --watch source config');
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

  it('maps all 3 agents in ai.plan.yml and does not depend on @zhin.js/workroom', async () => {
    const reviewed = await reviewAIPlan(parse(readText('ai.plan.yml')));
    const chat = reviewed.graph.purposes.defaults.chat!;
    expect(reviewed.graph.profiles[chat].model).toBe('deepseek-chat');
    expect(Object.keys(reviewed.graph.purposes.agents ?? {}).sort()).toEqual([...BOTS].sort());
    for (const bot of BOTS) expect(reviewed.graph.purposes.agents?.[bot]).toBe(chat);

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
