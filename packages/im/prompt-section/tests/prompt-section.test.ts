import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';
import promptSectionFeature, {
  PromptSectionIndex,
  defineAgentPromptSection,
  isPromptSectionIndex,
  promptSectionFeatureId,
} from '../src/index.js';

describe('Prompt Section Feature', () => {
  it('recognizes the public projection contract across package boundaries', () => {
    expect(isPromptSectionIndex({ $projection: 'zhin.prompt-section-index/1' })).toBe(true);
    expect(isPromptSectionIndex({ $projection: 'zhin.prompt-section-index/2' })).toBe(false);
  });

  it('discovers agent/prompt-sections modules as generation-owned sections', async () => {
    const source = '/project/agent/prompt-sections/project-rules.ts';
    const definition = defineAgentPromptSection({
      title: 'Project rules',
      content: 'Prefer repository-local conventions.',
      layer: 'context',
      order: 70,
      retention: 'preferred',
      maxChars: 800,
      profiles: ['interactive'],
      platforms: ['github'],
    });
    const host = new MemoryHost({
      '/project/agent/prompt-sections': [
        { name: 'project-rules.ts', kind: 'file' },
        { name: 'ignored.md', kind: 'file' },
      ],
    }, new Map([[source, { default: definition }]]));

    const slots = await new FeatureDiscovery(host).discover(promptSectionFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      localName: 'project-rules',
      source,
      definition,
    });
    expect(definition.platforms).toEqual(['github']);
    expect(Object.isFrozen(definition.platforms)).toBe(true);
  });

  it('resolves nearest-owner sections and filters by prompt profile', () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const rootDefinition = defineAgentPromptSection({
      title: 'Root rules',
      content: 'Root interactive rules.',
      profiles: ['interactive'],
    });
    const childDefinition = defineAgentPromptSection({
      title: 'Child rules',
      content: 'Child schedule rules.',
      profiles: ['schedule'],
    });
    const slots = [
      createCapabilitySlot({
        owner: root,
        feature: promptSectionFeatureId,
        localName: 'rules',
        source: '/project/agent/prompt-sections/rules.ts',
        definition: rootDefinition,
      }),
      createCapabilitySlot({
        owner: child,
        feature: promptSectionFeatureId,
        localName: 'rules',
        source: '/project/plugins/child/agent/prompt-sections/rules.ts',
        definition: childDefinition,
      }),
    ];
    const index = new PromptSectionIndex(slots, snapshot(slots));

    expect(index.visible(root, 'interactive').map((entry) => entry.title)).toEqual(['Root rules']);
    expect(index.visible(child, 'schedule').map((entry) => entry.title)).toEqual(['Child rules']);
    expect(index.visible(child, 'interactive')).toEqual([]);
  });

  it('rejects duplicate local identities owned by the same plugin', () => {
    const root = rootPluginId();
    const definition = defineAgentPromptSection({ title: 'Rules', content: 'One policy.' });
    const slots = [
      createCapabilitySlot({
        owner: root,
        feature: promptSectionFeatureId,
        localName: 'rules',
        source: '/project/agent/prompt-sections/rules.ts',
        definition,
      }),
      createCapabilitySlot({
        owner: root,
        feature: promptSectionFeatureId,
        localName: 'rules',
        source: '/project/agent/prompt-sections/duplicate.ts',
        definition,
      }),
    ];

    expect(() => new PromptSectionIndex(slots, snapshot(slots))).toThrow(
      /Duplicate owner Capability rules/,
    );
  });
});

function snapshot(slots: readonly ReturnType<typeof createCapabilitySlot>[]): RuntimeSnapshot {
  const root = rootPluginId();
  const child = childPluginId(root, 'child');
  return {
    generation: 7,
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [child] }],
      [child, { id: child, instanceKey: 'child', packageName: '@test/child', packageRoot: '/project/plugins/child', parent: root, children: [] }],
    ]),
    config: new Map([[root, {}], [child, {}]]),
    resources: new Map([[root, new Map()], [child, new Map()]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

class MemoryHost implements DiscoveryHost {
  constructor(
    private readonly directories: Readonly<Record<string, readonly DirectoryEntry[]>>,
    private readonly modules: ReadonlyMap<string, unknown>,
  ) {}
  async list(path: string): Promise<readonly DirectoryEntry[]> { return this.directories[path] ?? []; }
  async loadModule<T>(source: string): Promise<T> { return this.modules.get(source) as T; }
  async readText(): Promise<string> { throw new Error('Not implemented'); }
}
