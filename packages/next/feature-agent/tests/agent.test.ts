import { describe, expect, it } from 'vitest';
import {
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/next-kernel';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/next-feature-kit';
import agentFeature, {
  AgentIndex,
  agentFeatureId,
  parseAgentMarkdown,
} from '../src/index.js';

describe('Agent Feature', () => {
  it('discovers only agents/<name>.agent.md', async () => {
    const source = '/project/agents/planner.agent.md';
    const host = new MemoryHost({
      '/project/agents': [
        { name: 'planner.agent.md', kind: 'file' },
        { name: 'legacy.md', kind: 'file' },
        { name: 'nested', kind: 'directory' },
      ],
    }, new Map([[source, '# Planner\n\nPlan before acting.']]));
    const slots = await new FeatureDiscovery(host).discover(agentFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['planner']);
    expect(slots[0]?.definition.description).toBe('Planner');
  });

  it('projects immutable Agent descriptors', () => {
    const root = rootPluginId();
    const definition = parseAgentMarkdown('# Reviewer\n\nReview changes.', {
      owner: root,
      feature: agentFeatureId,
      localName: 'reviewer',
      source: '/agents/reviewer.agent.md',
    });
    const slot = createCapabilitySlot({
      owner: root,
      feature: agentFeatureId,
      localName: 'reviewer',
      source: '/agents/reviewer.agent.md',
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

    expect(descriptor).toMatchObject({ name: 'reviewer', qualifiedName: 'reviewer' });
    expect(Object.isFrozen(descriptor)).toBe(true);
  });
});

class MemoryHost implements DiscoveryHost {
  constructor(
    private readonly directories: Readonly<Record<string, readonly DirectoryEntry[]>>,
    private readonly files: ReadonlyMap<string, string>,
  ) {}
  async list(path: string): Promise<readonly DirectoryEntry[]> { return this.directories[path] ?? []; }
  async loadModule<T>(): Promise<T> { throw new Error('Not implemented'); }
  async readText(source: string): Promise<string> { return this.files.get(source) ?? ''; }
}
