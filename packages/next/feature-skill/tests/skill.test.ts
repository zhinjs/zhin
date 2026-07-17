import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/next-kernel';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/next-feature-kit';
import skillFeature, {
  SkillIndex,
  parseSkillMarkdown,
  skillFeatureId,
} from '../src/index.js';

describe('Skill Feature', () => {
  it('discovers only skills/<name>/SKILL.md and keeps Markdown as SSOT', async () => {
    const source = '/project/skills/research/SKILL.md';
    const host = new MemoryHost({
      '/project/skills': [
        { name: 'research', kind: 'directory' },
        { name: 'ignored.md', kind: 'file' },
      ],
      '/project/skills/research': [{ name: 'SKILL.md', kind: 'file' }],
    }, new Map([[source, '# Research\n\nUse primary sources.']]));
    const slots = await new FeatureDiscovery(host).discover(skillFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots).toHaveLength(1);
    expect(slots[0]?.localName).toBe('research');
    expect(slots[0]?.definition).toMatchObject({
      name: 'research',
      description: 'Research',
      instructions: '# Research\n\nUse primary sources.',
    });
  });

  it('uses nearest-owner Skill overrides', () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const definition = (owner: typeof root, instructions: string) => createCapabilitySlot({
      owner,
      feature: skillFeatureId,
      localName: 'review',
      source: `/${owner}/skills/review/SKILL.md`,
      definition: parseSkillMarkdown(instructions, {
        owner,
        feature: skillFeatureId,
        localName: 'review',
        source: `/${owner}/skills/review/SKILL.md`,
      }),
    });
    const slots = [definition(root, '# Root review'), definition(child, '# Child review')];
    const index = new SkillIndex(slots, snapshot(slots));

    expect(index.get(child, 'review')?.description).toBe('Child review');
    expect(index.get(root, 'review')?.description).toBe('Root review');
  });
});

function snapshot(slots: readonly ReturnType<typeof createCapabilitySlot>[]): RuntimeSnapshot {
  const root = rootPluginId();
  const child = childPluginId(root, 'child');
  return {
    generation: 1,
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
    private readonly files: ReadonlyMap<string, string>,
  ) {}
  async list(path: string): Promise<readonly DirectoryEntry[]> { return this.directories[path] ?? []; }
  async loadModule<T>(): Promise<T> { throw new Error('Not implemented'); }
  async readText(source: string): Promise<string> { return this.files.get(source) ?? ''; }
}
