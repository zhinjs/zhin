import { describe, expect, it } from 'vitest';
import {
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';
import agentFeature, {
  AgentIndex,
  agentFeatureId,
  parseAgentPackage,
  type AgentPackageSource,
} from '../src/index.js';

describe('Agent Feature', () => {
  it('discovers only complete agents/<name>/agent.json packages', async () => {
    const source = '/project/agents/planner/agent.json';
    const host = new MemoryHost({
      '/project/agents': [
        { name: 'planner', kind: 'directory' },
        { name: '$legacy.agent.md', kind: 'file' },
        { name: 'notes', kind: 'directory' },
      ],
      '/project/agents/planner': coreEntries(),
      '/project/agents/planner/workflows': [{ name: 'create-api.md', kind: 'file' }],
      '/project/agents/planner/tools': [{ name: 'inspect', kind: 'directory' }],
      '/project/agents/planner/tools/inspect': [{ name: 'index.ts', kind: 'file' }],
      '/project/agents/planner/skills': [{ name: 'review', kind: 'directory' }],
      '/project/agents/planner/skills/review': [{ name: 'SKILL.md', kind: 'file' }],
      '/project/agents/planner/knowledge': [],
      '/project/agents/notes': [{ name: 'README.md', kind: 'file' }],
    }, new Map([
      [source, JSON.stringify(manifest())],
      ...coreFiles('/project/agents/planner'),
      ['/project/agents/planner/workflows/create-api.md', '# Create API'],
    ]));
    const slots = await new FeatureDiscovery(host).discover(agentFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['planner']);
    expect(slots[0]?.definition).toMatchObject({
      displayName: 'Backend Engineer Agent',
      description: 'Plan before acting',
      triggerRules: { keywords: ['plan'] },
      workflows: [{ path: 'workflows/create-api.md' }],
      toolNames: ['agent__planner__inspect'],
      skillNames: ['agent__planner__review'],
    });
  });

  it('parses and validates the collaboration policy', () => {
    const parse = (collaboration: unknown) => parseAgentPackage(
      { ...packageSource(), manifest: { ...manifest(), collaboration } }, validation(),
    );
    expect(parseAgentPackage(packageSource(), validation()).collaboration).toBeUndefined();
    expect(parse({ contacts: ['coder', 'qa-bot'], accepts_from: ['human', 'planner'] }).collaboration)
      .toEqual({ contacts: ['coder', 'qa-bot'], acceptsFrom: ['human', 'planner'] });
    expect(parse({ acceptsFrom: ['human'] }).collaboration)
      .toEqual({ contacts: undefined, acceptsFrom: ['human'] });
    expect(parse({
      contacts: ['coder'],
      budget: { model_calls: 5, tokens: 10_000, wall_ms: 30_000, side_effects: 2 },
    }).collaboration).toEqual({
      contacts: ['coder'],
      acceptsFrom: undefined,
      budget: { modelCalls: 5, tokens: 10_000, wallMs: 30_000, sideEffects: 2 },
    });
    expect(parse({
      budget: { modelCalls: 3, wallMs: 5_000, sideEffects: 1 },
    }).collaboration).toEqual({
      contacts: undefined,
      acceptsFrom: undefined,
      budget: { modelCalls: 3, wallMs: 5_000, sideEffects: 1 },
    });
    expect(parse({}).collaboration).toEqual({ contacts: undefined, acceptsFrom: undefined });
    expect(() => parse({ contacts: ['Bad Name'] })).toThrow(/invalid agent name/);
    expect(() => parse({ accepts_from: ['Bad_Name'] })).toThrow(/invalid agent name/);
    expect(() => parse({ contacts: ['a', 'a'] })).toThrow(/duplicates/);
    expect(() => parse({ extra: [] })).toThrow(/unknown fields/);
    expect(() => parse(['x'])).toThrow(/must be an object/);
    expect(() => parse({ budget: 'lots' })).toThrow(/collaboration\.budget must be an object/);
    expect(() => parse({ budget: { unknown_key: 1 } })).toThrow(/collaboration\.budget has unknown fields/);
    expect(() => parse({ budget: { model_calls: 0 } })).toThrow(/positive integer/);
    expect(() => parse({ budget: { tokens: -10 } })).toThrow(/positive integer/);
  });

  it('rejects incomplete core entry points and traversal', () => {
    const source = packageSource();
    expect(() => parseAgentPackage({
      ...source,
      manifest: { ...manifest(), entry_points: ['system.md', '../secret.md'] },
    }, validation())).toThrow(/must include boundaries\.md/u);
    expect(() => parseAgentPackage({
      ...source,
      manifest: {
        ...manifest(),
        entry_points: ['system.md', 'boundaries.md', 'conventions.md', '../secret.md'],
      },
    }, validation())).toThrow(/root Markdown file/u);
  });

  it('projects immutable Agent descriptors', () => {
    const root = rootPluginId();
    const definition = parseAgentPackage(packageSource(), validation());
    const slot = createCapabilitySlot({
      owner: root,
      feature: agentFeatureId,
      localName: 'reviewer',
      source: '/agents/reviewer/agent.json',
      definition,
    });
    const value: RuntimeSnapshot = {
      generation: 1,
      root,
      tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [] }]]),
      config: new Map([[root, {}]]),
      resources: new Map([[root, new Map()]]),
      capabilities: new Map([[slot.id, slot]]),
      projections: new Map(),
    };
    const descriptor = new AgentIndex([slot], value).get(root, 'reviewer');

    expect(descriptor).toMatchObject({
      name: 'reviewer',
      displayName: 'Backend Engineer Agent',
      qualifiedName: 'reviewer',
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
  });
});

function manifest() {
  return {
    name: 'Backend Engineer Agent',
    version: '1.0.0',
    description: 'Plan before acting',
    trigger_rules: { file_patterns: ['src/**'], keywords: ['plan'] },
    entry_points: ['system.md', 'boundaries.md', 'conventions.md'],
  };
}

function packageSource(): AgentPackageSource {
  return {
    manifest: manifest(),
    files: Object.fromEntries(coreFiles('/agents/reviewer').map(([path, content]) => [
      path.split('/').at(-1)!, content,
    ])),
    workflows: [],
    knowledge: [],
  };
}

function validation() {
  return {
    owner: rootPluginId(),
    feature: agentFeatureId,
    localName: 'reviewer',
    source: '/agents/reviewer/agent.json',
  };
}

function coreEntries(): DirectoryEntry[] {
  return [
    { name: 'agent.json', kind: 'file' },
    { name: 'system.md', kind: 'file' },
    { name: 'boundaries.md', kind: 'file' },
    { name: 'conventions.md', kind: 'file' },
    { name: 'workflows', kind: 'directory' },
    { name: 'tools', kind: 'directory' },
    { name: 'skills', kind: 'directory' },
  ];
}

function coreFiles(root: string): Array<[string, string]> {
  return [
    [`${root}/system.md`, '# System\n\nPlan carefully.'],
    [`${root}/boundaries.md`, '# Boundaries\n\nStay in scope.'],
    [`${root}/conventions.md`, '# Conventions\n\nFollow AGENTS.md.'],
  ];
}

class MemoryHost implements DiscoveryHost {
  constructor(
    private readonly directories: Readonly<Record<string, readonly DirectoryEntry[]>>,
    private readonly files: ReadonlyMap<string, string>,
  ) {}
  async list(path: string): Promise<readonly DirectoryEntry[]> { return this.directories[path] ?? []; }
  async loadModule<T>(): Promise<T> { throw new Error('Not implemented'); }
  async readText(source: string): Promise<string> { return this.files.get(source) ?? ''; }
}
