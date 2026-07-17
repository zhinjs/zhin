import { isAbsolute, relative, resolve } from 'node:path';
import type { CapabilityId, FeatureId, PluginId, RuntimeSnapshot } from '@zhin.js/next-kernel';
import type { ProjectGraph, PluginGraphNode } from './project-graph.js';

export type SourceRole = 'plugin' | 'schema' | 'manifest' | 'feature' | 'capability';

export interface SourceOwnershipRecord {
  readonly source: string;
  readonly role: SourceRole;
  readonly owner: PluginId;
  readonly capability?: CapabilityId;
  readonly feature?: FeatureId;
}

interface PackageOwner {
  readonly packageRoot: string;
  readonly owner: PluginId;
}

export class SourceOwnershipIndex {
  readonly #records = new Map<string, SourceOwnershipRecord[]>();
  readonly #packages: PackageOwner[] = [];

  static empty(): SourceOwnershipIndex {
    return new SourceOwnershipIndex();
  }

  static fromGeneration(
    graph: ProjectGraph,
    snapshot: RuntimeSnapshot,
    featureIdsByPackageRoot: ReadonlyMap<string, FeatureId>,
  ): SourceOwnershipIndex {
    const index = new SourceOwnershipIndex();
    visitPlugin(graph.root, (node) => {
      index.addPackageRoot(node.package.root, node.id);
      index.add({
        source: resolve(node.package.root, node.package.packageJson.zhin.entry),
        role: 'plugin',
        owner: node.id,
      });
      index.add({
        source: resolve(node.package.root, 'schema.json'),
        role: 'schema',
        owner: node.id,
      });
      index.add({
        source: resolve(node.package.root, 'package.json'),
        role: 'manifest',
        owner: node.id,
      });
      for (const requirement of node.features) {
        const packageRoot = resolve(requirement.package.root);
        index.addPackageRoot(packageRoot, node.id);
        index.add({
          source: resolve(packageRoot, 'package.json'),
          role: 'manifest',
          owner: node.id,
          feature: featureIdsByPackageRoot.get(packageRoot),
        });
        index.add({
          source: resolve(packageRoot, requirement.package.packageJson.zhin.entry),
          role: 'feature',
          owner: node.id,
          feature: featureIdsByPackageRoot.get(packageRoot),
        });
      }
    });
    for (const slot of snapshot.capabilities.values()) {
      index.add({
        source: slot.source,
        role: 'capability',
        owner: slot.owner,
        capability: slot.id,
        feature: slot.feature,
      });
    }
    return index;
  }

  add(record: SourceOwnershipRecord): void {
    const source = normalizeSource(record.source);
    const records = this.#records.get(source) ?? [];
    if (!records.some((item) => sameRecord(item, record))) {
      records.push(Object.freeze({ ...record, source }));
      this.#records.set(source, records);
    }
  }

  addPackageRoot(packageRoot: string, owner: PluginId): void {
    const normalized = normalizeSource(packageRoot);
    if (!this.#packages.some((item) => item.packageRoot === normalized && item.owner === owner)) {
      this.#packages.push(Object.freeze({ packageRoot: normalized, owner }));
      this.#packages.sort((left, right) => right.packageRoot.length - left.packageRoot.length);
    }
  }

  recordsFor(source: string): readonly SourceOwnershipRecord[] {
    return Object.freeze([...(this.#records.get(normalizeSource(source)) ?? [])]);
  }

  ownersForPath(source: string): readonly PluginId[] {
    const normalized = normalizeSource(source);
    let longest = -1;
    const owners = new Set<PluginId>();
    for (const item of this.#packages) {
      if (!contains(item.packageRoot, normalized)) continue;
      if (item.packageRoot.length < longest) break;
      longest = item.packageRoot.length;
      owners.add(item.owner);
    }
    return Object.freeze([...owners]);
  }
}

function visitPlugin(node: PluginGraphNode, visit: (node: PluginGraphNode) => void): void {
  visit(node);
  for (const child of node.children) visitPlugin(child, visit);
}

function normalizeSource(source: string): string {
  return resolve(source);
}

function contains(packageRoot: string, source: string): boolean {
  const path = relative(packageRoot, source);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function sameRecord(left: SourceOwnershipRecord, right: SourceOwnershipRecord): boolean {
  return (
    left.role === right.role &&
    left.owner === right.owner &&
    left.capability === right.capability &&
    left.feature === right.feature
  );
}
