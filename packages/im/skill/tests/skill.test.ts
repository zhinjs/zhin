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
import skillFeature, {
  SkillIndex,
  parseSkillMarkdown,
  skillFeatureId,
} from '../src/index.js';

describe('Skill Feature', () => {
  it('discovers only skills/<name>/SKILL.md and keeps colocated files as ordinary material', async () => {
    const source = '/project/skills/research/SKILL.md';
    const host = new MemoryHost({
      '/project/skills': [
        { name: 'research', kind: 'directory' },
        { name: 'helper.md', kind: 'file' },
        { name: 'references', kind: 'directory' },
      ],
      '/project/skills/research': [
        { name: 'SKILL.md', kind: 'file' },
        { name: 'notes.md', kind: 'file' },
      ],
      '/project/skills/references': [{ name: 'README.md', kind: 'file' }],
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

  it('parses governed frontmatter and keeps only instructions in the prompt payload', () => {
    const definition = parseSkillMarkdown(`---
name: research
description: Evidence-first research
tools: [web_search, read_file]
platforms: [qq]
scopes: [private, group]
permissions: [role(trusted)]
keywords: [sources, citations]
tags: [research]
always: true
---

# Research

Use primary sources.`, {
      owner: rootPluginId(),
      feature: skillFeatureId,
      localName: 'research',
      source: '/project/skills/research/SKILL.md',
    });

    expect(definition).toMatchObject({
      name: 'research',
      description: 'Evidence-first research',
      instructions: '# Research\n\nUse primary sources.',
      toolNames: ['web_search', 'read_file'],
      platforms: ['qq'],
      scopes: ['private', 'group'],
      permissions: ['role(trusted)'],
      keywords: ['sources', 'citations'],
      tags: ['research'],
      always: true,
    });
    expect(Object.isFrozen(definition.toolNames)).toBe(true);
  });

  it('rejects frontmatter that can redirect identity or weaken scope validation', () => {
    const context = {
      owner: rootPluginId(),
      feature: skillFeatureId,
      localName: 'research',
      source: '/project/skills/research/SKILL.md',
    };
    expect(() => parseSkillMarkdown('---\nname: deploy\n---\n# Research', context))
      .toThrow('must match directory research');
    expect(() => parseSkillMarkdown('---\nscopes: [dm]\n---\n# Research', context))
      .toThrow('scopes must be private, group, or channel');
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
