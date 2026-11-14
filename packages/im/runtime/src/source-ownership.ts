import { normalizeSourcePath } from './source-path.js';
import { isAbsolute, relative, resolve } from 'node:path';
import type { CapabilityId, FeatureId, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ZhinFeatureManifest } from './manifest.js';
import type { ModuleWatchRoot } from './module-runtime.js';
import type { ProjectGraph, PluginGraphNode } from './project-graph.js';
import { PLATFORM_FEATURE_CARRIER, PLATFORM_FEATURE_FACADE } from './platform-features.js';

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
  readonly #watchRoots = new Map<string, ModuleWatchRoot>();
  readonly #revisionableRoots = new Set<string>();
  readonly #featureRoots = new Set<string>();
  readonly #childPluginManifests = new Set<string>();

  static empty(): SourceOwnershipIndex {
    return new SourceOwnershipIndex();
  }

  static fromGeneration(
    graph: ProjectGraph,
    snapshot: RuntimeSnapshot,
    featureIdsByPackageRoot: ReadonlyMap<string, FeatureId>,
  ): SourceOwnershipIndex {
    const index = new SourceOwnershipIndex();
    for (const pkg of graph.packages.values()) {
      if (pkg.source === 'node_modules') continue;
      index.addWatchRoot({ root: pkg.root, source: pkg.source });
    }
    visitPlugin(graph.root, (node) => {
      index.addPackageRoot(node.package.root, node.id);
      if (isRevisionablePluginPackage(node)) index.addRevisionableRoot(node.package.root);
      const entry = node.package.packageJson.zhin.entry;
      // Entry-less Plugins own no entry module; their convention files are indexed below.
      if (entry !== undefined) {
        index.add({
          source: resolve(node.package.root, entry),
          role: 'plugin',
          owner: node.id,
        });
      }
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
      if (node.parent !== undefined) index.addChildPluginManifest(resolve(node.package.root, 'package.json'));
      for (const requirement of node.features) {
        const packageRoot = resolve(requirement.package.root);
        index.addPackageRoot(packageRoot, node.id);
        index.addFeaturePackageRoot(packageRoot);
        index.add({
          source: resolve(packageRoot, 'package.json'),
          role: 'manifest',
          owner: node.id,
          feature: featureIdsByPackageRoot.get(packageRoot),
        });
        index.add({
          source: resolve(packageRoot, (requirement.package.packageJson.zhin as ZhinFeatureManifest).entry),
          role: 'feature',
          owner: node.id,
          feature: featureIdsByPackageRoot.get(packageRoot),
        });
      }
    });
    for (const slot of snapshot.capabilities.values()) {
      if (slot.origin === 'setup') continue;
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

  moduleSources(): readonly string[] {
    return Object.freeze([...this.#records.entries()]
      .filter(([, records]) => records.some((record) => (
        record.role === 'plugin' || record.role === 'feature' || record.role === 'capability'
      )))
      .map(([source]) => source)
      .sort());
  }

  /** `package.json` files of mounted Plugin and Feature packages. */
  manifestSources(): readonly string[] {
    return Object.freeze([...this.#records.entries()]
      .filter(([, records]) => records.some((record) => record.role === 'manifest'))
      .map(([source]) => source)
      .sort());
  }

  /**
   * Package roots of mounted child Plugins built from local sources (#1250
   * `hmr-stale-cross-package-import`): a module imported from one of them by package name is
   * reloaded together with its importer, like a relative import.
   */
  revisionableRoots(): readonly string[] {
    return Object.freeze([...this.#revisionableRoots].sort());
  }

  addRevisionableRoot(packageRoot: string): void {
    this.#revisionableRoots.add(normalizeSource(packageRoot));
  }

  /**
   * Whether the source is the `package.json` of a mounted child Plugin (not the Root project):
   * its `version` is part of the committed Plugin tree (`packageVersion`, #1250).
   */
  isChildPluginManifest(source: string): boolean {
    return this.#childPluginManifests.has(normalizeSource(source));
  }

  addChildPluginManifest(source: string): void {
    this.#childPluginManifests.add(normalizeSource(source));
  }

  /** Whether the source lies inside the package root of a Feature some mounted Plugin requires. */
  isInFeaturePackage(source: string): boolean {
    const normalized = normalizeSource(source);
    return [...this.#featureRoots].some((root) => contains(root, normalized));
  }

  addFeaturePackageRoot(packageRoot: string): void {
    this.#featureRoots.add(normalizeSource(packageRoot));
  }

  watchRoots(): readonly ModuleWatchRoot[] {
    return Object.freeze([...this.#watchRoots.values()]);
  }

  addWatchRoot(root: ModuleWatchRoot): void {
    const normalized = normalizeSourcePath(root.root);
    this.#watchRoots.set(normalized, Object.freeze({ ...root, root: normalized }));
  }
}

/**
 * Framework packages (`zhin.js`, `@zhin.js/core`) can be Plugin packages too; reloading a copy of
 * them for one importer would split framework identity, so they are never revisioned.
 */
function isRevisionablePluginPackage(node: PluginGraphNode): boolean {
  return node.parent !== undefined
    && node.package.source !== 'node_modules'
    && node.package.name !== PLATFORM_FEATURE_CARRIER
    && node.package.name !== PLATFORM_FEATURE_FACADE;
}

function visitPlugin(node: PluginGraphNode, visit: (node: PluginGraphNode) => void): void {
  visit(node);
  for (const child of node.children) visitPlugin(child, visit);
}

function normalizeSource(source: string): string {
  return normalizeSourcePath(source);
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
