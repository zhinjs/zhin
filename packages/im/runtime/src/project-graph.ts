import { childPluginId, rootPluginId, type PluginId } from '@zhin.js/plugin-runtime';
import {
  assertFeatureApi,
  assertPackageEngine,
  runtimeEngineVersion,
} from './compatibility.js';
import type {
  ChildPluginReference,
  PackageReference,
} from './manifest.js';
import {
  PackageResolutionError,
  type PackageResolver,
  type ResolvedPackage,
} from './package-resolver.js';
import {
  PLATFORM_FEATURE_CARRIER,
  PLATFORM_FEATURE_FACADE,
  declaredPackageDependency,
  mergeChildPluginReferences,
  mergeFeatureReferences,
} from './platform-features.js';

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

export interface ProjectGraphServiceOptions {
  readonly engineVersion?: string;
  readonly disabledPluginInstanceKeys?: readonly string[];
}

export class ProjectGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectGraphError';
  }
}

export class ProjectGraphService {
  readonly #resolver: PackageResolver;
  readonly #engineVersion: string;
  readonly #disabledPluginInstanceKeys: ReadonlySet<string>;

  constructor(
    resolver: PackageResolver,
    engineVersionOrOptions: string | ProjectGraphServiceOptions = runtimeEngineVersion,
  ) {
    this.#resolver = resolver;
    this.#engineVersion = typeof engineVersionOrOptions === 'string'
      ? engineVersionOrOptions
      : (engineVersionOrOptions.engineVersion ?? runtimeEngineVersion);
    this.#disabledPluginInstanceKeys = new Set(
      typeof engineVersionOrOptions === 'string'
        ? []
        : (engineVersionOrOptions.disabledPluginInstanceKeys ?? []),
    );
  }

  async inspect(projectRoot: string): Promise<ProjectGraph> {
    const rootPackage = await this.#resolver.root(projectRoot);
    assertPackageType(rootPackage, 'plugin');
    const packages = new Map<string, ResolvedPackage>();
    const root = await this.#visitPlugin(
      rootPackage,
      rootPluginId(),
      'root',
      undefined,
      [],
      packages,
      true,
    );
    for (const pkg of this.#resolver.workspacePackages()) addPackage(packages, pkg);
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
    isRoot: boolean,
  ): Promise<PluginGraphNode> {
    if (ancestors.includes(pkg.root)) {
      throw new ProjectGraphError(
        `Plugin cycle detected: ${[...ancestors, pkg.root].join(' -> ')}`,
      );
    }
    const manifest = assertPackageType(pkg, 'plugin');
    assertPackageEngine(pkg, this.#engineVersion);
    addPackage(packages, pkg);

    let featureCarrier: ResolvedPackage | undefined;
    let pluginFacade: ResolvedPackage | undefined;
    let featureRefs = manifest.features;
    let pluginRefs = manifest.plugins;
    if (isRoot && manifest.platformFeatures !== false) {
      const platform = await tryResolvePlatform(this.#resolver, pkg);
      featureCarrier = platform.featureCarrier;
      pluginFacade = platform.pluginFacade;
      if (featureCarrier) {
        addPackage(packages, featureCarrier);
        const carrierManifest = featureCarrier.packageJson.zhin;
        const inherited = carrierManifest.type === 'plugin' ? carrierManifest.features : [];
        featureRefs = mergeFeatureReferences(manifest.features, inherited);
      }
      if (pluginFacade) {
        addPackage(packages, pluginFacade);
        const facadeManifest = pluginFacade.packageJson.zhin;
        const inheritedPlugins = facadeManifest.type === 'plugin' ? facadeManifest.plugins : [];
        pluginRefs = mergeChildPluginReferences(manifest.plugins, inheritedPlugins);
      }
    }
    if (isRoot && this.#disabledPluginInstanceKeys.size > 0) {
      pluginRefs = pluginRefs.filter(
        (reference) => !this.#disabledPluginInstanceKeys.has(reference.instanceKey),
      );
    }

    const featurePackages = new Set<string>();
    const features = await Promise.all(
      featureRefs.map(async (reference) => {
        if (featurePackages.has(reference.package)) {
          throw new ProjectGraphError(
            `Duplicate Feature requirement ${reference.package} in ${pkg.name}`,
          );
        }
        featurePackages.add(reference.package);
        const resolved = await this.#resolveFeatureReference(pkg, reference, featureCarrier);
        if (!resolved) return undefined;
        assertPackageType(resolved, 'feature');
        assertPackageEngine(resolved, this.#engineVersion);
        assertFeatureApi(pkg, reference, resolved);
        addPackage(packages, resolved);
        return Object.freeze({ reference, package: resolved });
      }),
    );

    const ownPluginKeys = new Set(manifest.plugins.map((item) => item.instanceKey));
    const instanceKeys = new Set<string>();
    const children = await Promise.all(
      pluginRefs.map(async (reference) => {
        if (instanceKeys.has(reference.instanceKey)) {
          throw new ProjectGraphError(
            `Duplicate child instanceKey ${reference.instanceKey} in ${pkg.name}`,
          );
        }
        instanceKeys.add(reference.instanceKey);
        const resolveFrom = ownPluginKeys.has(reference.instanceKey) ? pkg : (pluginFacade ?? pkg);
        const resolved = await resolveReference(this.#resolver, resolveFrom, reference);
        if (!resolved) return undefined;
        assertPackageType(resolved, 'plugin');
        return this.#visitPlugin(
          resolved,
          childPluginId(id, reference.instanceKey),
          reference.instanceKey,
          id,
          [...ancestors, pkg.root],
          packages,
          false,
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

  async #resolveFeatureReference(
    pkg: ResolvedPackage,
    reference: PackageReference,
    featureCarrier: ResolvedPackage | undefined,
  ): Promise<ResolvedPackage | undefined> {
    try {
      return await this.#resolver.resolve(reference.package, pkg);
    } catch (error) {
      // 非解析类错误（损坏的 package.json 等）不回退、不容错，直接上抛。
      if (!(error instanceof PackageResolutionError)) throw error;
      // carrier 回退：继承自 @zhin.js/core 的 Feature 引用声明在 carrier 上，
      // 从引用包解析失败（未声明 / 未安装 / workspace 链接缺失）时改从 carrier 解析。
      if (featureCarrier) return resolveReference(this.#resolver, featureCarrier, reference);
      // 无 carrier 时按统一规则处理：optional 引用容错，其余上抛。
      if (reference.optional) return undefined;
      throw error;
    }
  }
}

async function tryResolvePlatform(
  resolver: PackageResolver,
  from: ResolvedPackage,
): Promise<{
  readonly featureCarrier?: ResolvedPackage;
  readonly pluginFacade?: ResolvedPackage;
}> {
  let featureCarrier: ResolvedPackage | undefined;
  let pluginFacade: ResolvedPackage | undefined;

  const directCore = declaredPackageDependency(
    from.packageJson.dependencies,
    from.packageJson.optionalDependencies,
    PLATFORM_FEATURE_CARRIER,
  );
  if (directCore) {
    try {
      featureCarrier = await resolver.resolve(PLATFORM_FEATURE_CARRIER, from);
    } catch (error) {
      if (!(error instanceof PackageResolutionError)) throw error;
    }
  }

  const facadeDecl = declaredPackageDependency(
    from.packageJson.dependencies,
    from.packageJson.optionalDependencies,
    PLATFORM_FEATURE_FACADE,
  );
  if (facadeDecl) {
    try {
      pluginFacade = await resolver.resolve(PLATFORM_FEATURE_FACADE, from);
      if (!featureCarrier) {
        featureCarrier = await resolver.resolve(PLATFORM_FEATURE_CARRIER, pluginFacade);
      }
    } catch (error) {
      if (!(error instanceof PackageResolutionError)) throw error;
      pluginFacade = undefined;
    }
  }

  return { featureCarrier, pluginFacade };
}

async function resolveReference(
  resolver: PackageResolver,
  from: ResolvedPackage,
  reference: PackageReference | ChildPluginReference,
): Promise<ResolvedPackage | undefined> {
  try {
    return await resolver.resolve(reference.package, from);
  } catch (error) {
    // optional 引用对所有 PackageResolutionError 统一容错（未声明 / 未安装 /
    // workspace 链接缺失）；非解析类错误（损坏的 package.json 等）继续上抛。
    if (reference.optional && error instanceof PackageResolutionError) return undefined;
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
