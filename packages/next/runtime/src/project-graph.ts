import { childPluginId, rootPluginId, type PluginId } from '@zhin.js/next-kernel';
import type {
  ChildPluginReference,
  PackageReference,
} from './manifest.js';
import {
  PackageResolutionError,
  type PackageResolver,
  type ResolvedPackage,
} from './package-resolver.js';

export interface FeatureRequirementNode {
  readonly reference: PackageReference;
  readonly package: ResolvedPackage;
}

export interface PluginGraphNode {
  readonly id: PluginId;
  readonly instanceKey: string;
  readonly package: ResolvedPackage;
  readonly parent?: PluginId;
  readonly features: readonly FeatureRequirementNode[];
  readonly children: readonly PluginGraphNode[];
}

export interface ProjectGraph {
  // root is the logical runtime tree. packages/buildOrder are the deduplicated
  // physical package graph; one package may appear at several logical mounts.
  readonly root: PluginGraphNode;
  readonly packages: ReadonlyMap<string, ResolvedPackage>;
  readonly buildOrder: readonly ResolvedPackage[];
}

export class ProjectGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectGraphError';
  }
}

export class ProjectGraphService {
  constructor(private readonly resolver: PackageResolver) {}

  async inspect(projectRoot: string): Promise<ProjectGraph> {
    const rootPackage = await this.resolver.root(projectRoot);
    assertPackageType(rootPackage, 'plugin');
    const packages = new Map<string, ResolvedPackage>();
    const root = await this.#visitPlugin(
      rootPackage,
      rootPluginId(),
      'root',
      undefined,
      [],
      packages,
    );
    for (const pkg of this.resolver.workspacePackages()) addPackage(packages, pkg);
    return Object.freeze({
      root,
      packages,
      buildOrder: topologicalBuildOrder(packages),
    });
  }

  async #visitPlugin(
    pkg: ResolvedPackage,
    id: PluginId,
    instanceKey: string,
    parent: PluginId | undefined,
    ancestors: readonly string[],
    packages: Map<string, ResolvedPackage>,
  ): Promise<PluginGraphNode> {
    if (ancestors.includes(pkg.root)) {
      throw new ProjectGraphError(
        `Plugin cycle detected: ${[...ancestors, pkg.root].join(' -> ')}`,
      );
    }
    const manifest = assertPackageType(pkg, 'plugin');
    addPackage(packages, pkg);

    const featurePackages = new Set<string>();
    const features = await Promise.all(
      manifest.features.map(async (reference) => {
        if (featurePackages.has(reference.package)) {
          throw new ProjectGraphError(
            `Duplicate Feature requirement ${reference.package} in ${pkg.name}`,
          );
        }
        featurePackages.add(reference.package);
        const resolved = await resolveReference(this.resolver, pkg, reference);
        if (!resolved) return undefined;
        assertPackageType(resolved, 'feature');
        addPackage(packages, resolved);
        return Object.freeze({ reference, package: resolved });
      }),
    );

    const instanceKeys = new Set<string>();
    const children = await Promise.all(
      manifest.plugins.map(async (reference) => {
        if (instanceKeys.has(reference.instanceKey)) {
          throw new ProjectGraphError(
            `Duplicate child instanceKey ${reference.instanceKey} in ${pkg.name}`,
          );
        }
        instanceKeys.add(reference.instanceKey);
        const resolved = await resolveReference(this.resolver, pkg, reference);
        if (!resolved) return undefined;
        assertPackageType(resolved, 'plugin');
        return this.#visitPlugin(
          resolved,
          childPluginId(id, reference.instanceKey),
          reference.instanceKey,
          id,
          [...ancestors, pkg.root],
          packages,
        );
      }),
    );

    return Object.freeze({
      id,
      instanceKey,
      package: pkg,
      parent,
      features: Object.freeze(features.filter(isDefined)),
      children: Object.freeze(children.filter(isDefined)),
    });
  }
}

async function resolveReference(
  resolver: PackageResolver,
  from: ResolvedPackage,
  reference: PackageReference | ChildPluginReference,
): Promise<ResolvedPackage | undefined> {
  try {
    return await resolver.resolve(reference.package, from);
  } catch (error) {
    if (
      reference.optional
      && error instanceof PackageResolutionError
      && error.message.startsWith('Cannot resolve')
    ) return undefined;
    throw error;
  }
}

function assertPackageType<T extends 'plugin' | 'feature'>(
  pkg: ResolvedPackage,
  type: T,
): Extract<ResolvedPackage['packageJson']['zhin'], { type: T }> {
  if (pkg.packageJson.zhin.type !== type) {
    throw new ProjectGraphError(`${pkg.name} must be a Zhin ${type} package`);
  }
  return pkg.packageJson.zhin as Extract<
    ResolvedPackage['packageJson']['zhin'],
    { type: T }
  >;
}

function topologicalBuildOrder(
  packages: ReadonlyMap<string, ResolvedPackage>,
): readonly ResolvedPackage[] {
  const result: ResolvedPackage[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visitPackage = (pkg: ResolvedPackage): void => {
    if (visited.has(pkg.root)) return;
    if (visiting.has(pkg.root)) {
      throw new ProjectGraphError(`Package dependency cycle detected at ${pkg.name}`);
    }
    visiting.add(pkg.root);
    const dependencies = {
      ...pkg.packageJson.dependencies,
      ...pkg.packageJson.optionalDependencies,
    };
    for (const name of Object.keys(dependencies)) {
      const dependency = packages.get(name);
      if (dependency) visitPackage(dependency);
    }
    visiting.delete(pkg.root);
    visited.add(pkg.root);
    result.push(pkg);
  };
  for (const pkg of packages.values()) visitPackage(pkg);
  return Object.freeze(result);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function addPackage(
  packages: Map<string, ResolvedPackage>,
  pkg: ResolvedPackage,
): void {
  const previous = packages.get(pkg.name);
  if (previous && previous.root !== pkg.root) {
    throw new ProjectGraphError(
      `Multiple package locations for ${pkg.name} are not supported in one generation`,
    );
  }
  packages.set(pkg.name, pkg);
}
