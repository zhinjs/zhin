import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capabilityId, childPluginId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import {
  InvalidationPlanner,
  SourceOwnershipIndex,
  type DependencyImpactPort,
} from '../src/index.js';

const root = rootPluginId();
const child = childPluginId(root, 'child');
const sibling = childPluginId(root, 'sibling');
const commandFeature = featureId('zhin.command');
const childCommand = capabilityId(child, commandFeature, 'status');
const siblingCommand = capabilityId(sibling, commandFeature, 'status');

function ownership(): SourceOwnershipIndex {
  const index = new SourceOwnershipIndex();
  index.addPackageRoot('/project', root);
  index.addPackageRoot('/project/plugins/child', child);
  index.addPackageRoot('/project/plugins/sibling', sibling);
  index.add({
    source: '/project/plugin.ts',
    role: 'plugin',
    owner: root,
  });
  index.add({
    source: '/project/schema.json',
    role: 'schema',
    owner: root,
  });
  index.add({
    source: '/project/plugins/child/commands/status.ts',
    role: 'capability',
    owner: child,
    capability: childCommand,
    feature: commandFeature,
  });
  index.add({
    source: '/project/plugins/sibling/commands/status.ts',
    role: 'capability',
    owner: sibling,
    capability: siblingCommand,
    feature: commandFeature,
  });
  index.add({
    source: '/project/plugins/child/plugin.ts',
    role: 'plugin',
    owner: child,
  });
  index.add({
    source: '/project/plugins/child/schema.json',
    role: 'schema',
    owner: child,
  });
  index.add({
    source: '/project/packages/command/provider.ts',
    role: 'feature',
    owner: child,
    feature: commandFeature,
  });
  index.add({
    source: '/project/packages/command/provider.ts',
    role: 'feature',
    owner: sibling,
    feature: commandFeature,
  });
  return index;
}

describe('InvalidationPlanner', () => {
  it('keeps a direct Capability change at Slot scope', () => {
    const plan = new InvalidationPlanner(ownership()).plan([
      '/project/plugins/child/commands/status.ts',
    ]);

    expect(plan).toMatchObject({
      kind: 'generation',
      slots: [childCommand],
      subtrees: [],
    });
  });

  it('uses reverse importers to classify an otherwise untracked support module', () => {
    const dependencies: DependencyImpactPort = {
      affectedSources: () => ['/project/plugins/child/commands/status.ts'],
    };
    const plan = new InvalidationPlanner(ownership(), dependencies).plan([
      '/project/plugins/child/shared/format.ts',
    ]);

    expect(plan).toMatchObject({ kind: 'generation', slots: [childCommand] });
  });

  it('escalates setup and schema changes to their Plugin subtree', () => {
    const plan = new InvalidationPlanner(ownership()).plan([
      '/project/plugins/child/schema.json',
      '/project/plugins/child/plugin.ts',
    ]);

    expect(plan).toMatchObject({
      kind: 'generation',
      slots: [],
      subtrees: [child],
    });
  });

  it('requires a process restart for Root setup and schema changes', () => {
    const plan = new InvalidationPlanner(ownership()).plan([
      '/project/plugin.ts',
      '/project/schema.json',
    ]);

    expect(plan).toEqual({
      kind: 'process',
      changed: ['/project/plugin.ts', '/project/schema.json'],
      reasons: ['Root plugin source changed', 'Root schema source changed'],
    });
  });

  it('rebuilds every owner using a changed Feature provider', () => {
    const plan = new InvalidationPlanner(ownership()).plan([
      '/project/packages/command/provider.ts',
    ]);

    expect(plan).toMatchObject({
      kind: 'generation',
      subtrees: [child, sibling],
    });
  });

  it('falls back to the nearest package owner for an untracked source', () => {
    const plan = new InvalidationPlanner(ownership()).plan([
      join('/project/plugins/child', 'shared/unknown.ts'),
    ]);
    expect(plan).toMatchObject({ kind: 'generation', subtrees: [child] });
  });

  it('requires a process restart for workspace dependency state', () => {
    const plan = new InvalidationPlanner(ownership()).plan(['/project/pnpm-lock.yaml']);
    expect(plan.kind).toBe('process');
  });
});
