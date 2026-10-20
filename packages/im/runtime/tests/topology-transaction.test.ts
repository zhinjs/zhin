import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  rootPluginId,
  type PluginId,
} from '@zhin.js/plugin-runtime';
import {
  TopologyTransactionPlanner,
  type PluginGraphNode,
  type ProjectGraph,
  type ResolvedPackage,
} from '../src/index.js';

describe('TopologyTransactionPlanner', () => {
  it('models a child move as one removed mount and one added mount', () => {
    const root = rootPluginId();
    const a = childPluginId(root, 'a');
    const b = childPluginId(root, 'b');
    const oldC = childPluginId(b, 'c');
    const nextC = childPluginId(a, 'c');
    const previous = graph(node(root, [
      node(a),
      node(b, [node(oldC)]),
    ]));
    const next = graph(node(root, [
      node(a, [node(nextC)]),
      node(b),
    ]));

    const plan = new TopologyTransactionPlanner().plan(previous, next);

    expect(plan.addedPluginRoots).toEqual([nextC]);
    expect(plan.removedPluginRoots).toEqual([oldC]);
    expect(plan.replacedPluginRoots).toEqual([]);
    expect(plan.treeChanged).toBe(true);
    expect(plan.changed).toBe(true);
  });

  it('tracks Feature moves and provider manifest changes independently of Scopes', () => {
    const root = rootPluginId();
    const a = childPluginId(root, 'a');
    const b = childPluginId(root, 'b');
    const oldFeature = featurePackage('./index.ts');
    const nextFeature = featurePackage('./next.ts');
    const previous = graph(node(root, [
      node(a, [], [oldFeature]),
      node(b),
    ]));
    const next = graph(node(root, [
      node(a),
      node(b, [], [nextFeature]),
    ]));

    const plan = new TopologyTransactionPlanner().plan(previous, next);

    expect(plan.addedFeatures).toEqual([{ owner: b, packageRoot: '/feature/command' }]);
    expect(plan.removedFeatures).toEqual([{ owner: a, packageRoot: '/feature/command' }]);
    expect(plan.reloadedFeaturePackages).toEqual(new Set(['/feature/command']));
    expect(plan.replacedPluginRoots).toEqual([]);
  });

  it('does not publish a transaction for an equivalent graph', () => {
    const root = node(rootPluginId());
    const graphValue = graph(root);

    expect(new TopologyTransactionPlanner().plan(graphValue, graphValue).changed).toBe(false);
  });
});

function graph(root: PluginGraphNode): ProjectGraph {
  return {
    root,
    packages: new Map(),
    buildOrder: [],
  };
}

function node(
  id: PluginId,
  children: readonly PluginGraphNode[] = [],
  features: readonly ResolvedPackage[] = [],
): PluginGraphNode {
  const parent = id === 'root'
    ? undefined
    : id.slice(0, id.lastIndexOf('/')) as PluginId;
  return {
    id,
    instanceKey: id === 'root' ? 'root' : id.slice(id.lastIndexOf('/') + 1),
    package: pluginPackage(id),
    parent,
    features: features.map((pkg) => ({
      reference: { package: pkg.name },
      package: pkg,
    })),
    children,
  };
}

function pluginPackage(id: PluginId): ResolvedPackage {
  const name = id === 'root' ? '@test/root' : `@test/${id.slice(id.lastIndexOf('/') + 1)}`;
  return {
    name,
    root: `/plugin/${id}`,
    source: 'workspace',
    packageJson: {
      name,
      zhin: {
        protocol: 1,
        type: 'plugin',
        entry: './plugin.ts',
        features: [],
        plugins: [],
      },
    },
  };
}

function featurePackage(entry: string): ResolvedPackage {
  return {
    name: '@test/command',
    root: '/feature/command',
    source: 'workspace',
    packageJson: {
      name: '@test/command',
      zhin: {
        protocol: 1,
        type: 'feature',
        entry,
      },
    },
  };
}
