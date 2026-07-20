import { resolve } from 'node:path';
import type { PluginId } from '@zhin.js/plugin-runtime';
import type { ZhinFeatureManifest, ZhinPluginManifest } from './manifest.js';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';

export interface FeatureMount {
  readonly owner: PluginId;
  readonly packageRoot: string;
}

export interface TopologyTransactionPlan {
  readonly addedPluginRoots: readonly PluginId[];
  readonly removedPluginRoots: readonly PluginId[];
  readonly replacedPluginRoots: readonly PluginId[];
  readonly addedFeatures: readonly FeatureMount[];
  readonly removedFeatures: readonly FeatureMount[];
  readonly reloadedFeaturePackages: ReadonlySet<string>;
  readonly treeChanged: boolean;
  readonly featureOrderChanged: boolean;
  readonly changed: boolean;
}

/** Compiles two resolved graphs into the smallest safe topology transaction. */
export class TopologyTransactionPlanner {
  plan(previous: ProjectGraph, next: ProjectGraph): TopologyTransactionPlan {
    const previousNodes = indexGraph(previous);
    const nextNodes = indexGraph(next);
    const added = [...nextNodes.keys()].filter((id) => !previousNodes.has(id));
    const removed = [...previousNodes.keys()].filter((id) => !nextNodes.has(id));
    const replaced = [...nextNodes].flatMap(([id, node]) => {
      const old = previousNodes.get(id);
      return old && scopeContractChanged(old, node) ? [id] : [];
    });
    const addedPluginRoots = collapseRoots(added);
    const removedPluginRoots = collapseRoots(removed);
    const replacedPluginRoots = collapseRoots(replaced);
    const previousFeatures = featureMounts(previous);
    const nextFeatures = featureMounts(next);
    const addedFeatures = difference(nextFeatures, previousFeatures);
    const removedFeatures = difference(previousFeatures, nextFeatures);
    const reloadedFeaturePackages = changedFeaturePackages(previous, next);
    const treeChanged = childOrderChanged(previousNodes, nextNodes);
    const featureOrderChanged = !sameValues(
      previousFeatures.map(featureMountKey),
      nextFeatures.map(featureMountKey),
    );
    const changed = (
      addedPluginRoots.length > 0
      || removedPluginRoots.length > 0
      || replacedPluginRoots.length > 0
      || addedFeatures.length > 0
      || removedFeatures.length > 0
      || reloadedFeaturePackages.size > 0
      || treeChanged
      || featureOrderChanged
    );

    return Object.freeze({
      addedPluginRoots,
      removedPluginRoots,
      replacedPluginRoots,
      addedFeatures,
      removedFeatures,
      reloadedFeaturePackages,
      treeChanged,
      featureOrderChanged,
      changed,
    });
  }
}

export function graphNodes(graph: ProjectGraph): ReadonlyMap<PluginId, PluginGraphNode> {
  return indexGraph(graph);
}

export function graphOrder(graph: ProjectGraph): readonly PluginId[] {
  return Object.freeze([...indexGraph(graph).keys()]);
}

export function featureMounts(graph: ProjectGraph): readonly FeatureMount[] {
  const mounts: FeatureMount[] = [];
  for (const node of indexGraph(graph).values()) {
    for (const feature of node.features) {
      mounts.push(Object.freeze({
        owner: node.id,
        packageRoot: resolve(feature.package.root),
      }));
    }
  }
  return Object.freeze(mounts);
}

export function isWithin(plugin: PluginId, root: PluginId): boolean {
  return plugin === root || plugin.startsWith(`${root}/`);
}

export function collapseRoots(values: readonly PluginId[]): readonly PluginId[] {
  const sorted = [...new Set(values)].sort((left, right) => left.length - right.length);
  const roots: PluginId[] = [];
  for (const candidate of sorted) {
    if (!roots.some((root) => isWithin(candidate, root))) roots.push(candidate);
  }
  return Object.freeze(roots);
}

function indexGraph(graph: ProjectGraph): ReadonlyMap<PluginId, PluginGraphNode> {
  const nodes = new Map<PluginId, PluginGraphNode>();
  const visit = (node: PluginGraphNode): void => {
    nodes.set(node.id, node);
    for (const child of node.children) visit(child);
  };
  visit(graph.root);
  return nodes;
}

function scopeContractChanged(previous: PluginGraphNode, next: PluginGraphNode): boolean {
  const previousManifest = previous.package.packageJson.zhin as ZhinPluginManifest;
  const nextManifest = next.package.packageJson.zhin as ZhinPluginManifest;
  return (
    previous.parent !== next.parent
    || previous.instanceKey !== next.instanceKey
    || previous.package.root !== next.package.root
    || previous.package.name !== next.package.name
    || previousManifest.entry !== nextManifest.entry
    || previousManifest.runtime !== nextManifest.runtime
    || previousManifest.engine !== nextManifest.engine
  );
}

function childOrderChanged(
  previous: ReadonlyMap<PluginId, PluginGraphNode>,
  next: ReadonlyMap<PluginId, PluginGraphNode>,
): boolean {
  for (const [id, node] of next) {
    const old = previous.get(id);
    if (!old) continue;
    const oldChildren = old.children.map((child) => child.id);
    const nextChildren = node.children.map((child) => child.id);
    if (!sameValues(oldChildren, nextChildren)) return true;
  }
  return false;
}

function changedFeaturePackages(
  previous: ProjectGraph,
  next: ProjectGraph,
): ReadonlySet<string> {
  const previousPackages = featurePackages(previous);
  const result = new Set<string>();
  for (const [root, pkg] of featurePackages(next)) {
    const old = previousPackages.get(root);
    if (!old) continue;
    const oldManifest = old.packageJson.zhin as ZhinFeatureManifest;
    const nextManifest = pkg.packageJson.zhin as ZhinFeatureManifest;
    if (
      old.name !== pkg.name
      || oldManifest.entry !== nextManifest.entry
      || oldManifest.engine !== nextManifest.engine
      || oldManifest.featureApi !== nextManifest.featureApi
    ) result.add(root);
  }
  return result;
}

function featurePackages(graph: ProjectGraph) {
  const packages = new Map<string, PluginGraphNode['features'][number]['package']>();
  for (const node of indexGraph(graph).values()) {
    for (const feature of node.features) {
      packages.set(resolve(feature.package.root), feature.package);
    }
  }
  return packages;
}

function difference(
  left: readonly FeatureMount[],
  right: readonly FeatureMount[],
): readonly FeatureMount[] {
  const rightKeys = new Set(right.map(featureMountKey));
  return Object.freeze(left.filter((mount) => !rightKeys.has(featureMountKey(mount))));
}

function featureMountKey(mount: FeatureMount): string {
  return `${mount.owner}\0${mount.packageRoot}`;
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
