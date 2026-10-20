import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { ZhinPluginManifest } from './manifest.js';
import type { ProcessInvalidationPlan } from './invalidation-planner.js';
import type { ResolvedPackage } from './package-resolver.js';
import type { ProjectGraph } from './project-graph.js';
import { graphNodes } from './topology-transaction.js';

/** Decides which manifest changes cannot remain inside a generation transaction. */
export class RestartBoundaryPlanner {
  plan(
    previous: ProjectGraph,
    next: ProjectGraph,
    changed: readonly string[],
  ): ProcessInvalidationPlan | undefined {
    const reasons = new Set<string>();
    const previousPackages = mountedPackages(previous);
    const nextPackages = mountedPackages(next);

    for (const [root, pkg] of nextPackages) {
      const old = previousPackages.get(root);
      if (!old) continue;
      if (runtimeAbiChanged(old, pkg)) {
        reasons.add(`package runtime ABI changed: ${pkg.name}`);
      }
      const oldManifest = old.packageJson.zhin;
      const nextManifest = pkg.packageJson.zhin;
      if (oldManifest.engine !== nextManifest.engine) {
        reasons.add(`runtime engine contract changed: ${pkg.name}`);
      }
      if (
        oldManifest.type === 'feature'
        && nextManifest.type === 'feature'
        && oldManifest.featureApi !== nextManifest.featureApi
      ) reasons.add(`Feature API contract changed: ${pkg.name}`);
      if (
        oldManifest.type === 'plugin'
        && nextManifest.type === 'plugin'
        && oldManifest.runtime !== nextManifest.runtime
      ) reasons.add(`Plugin execution runtime changed: ${pkg.name}`);
    }

    const oldRoot = previous.root.package;
    const nextRoot = next.root.package;
    const oldRootManifest = oldRoot.packageJson.zhin as ZhinPluginManifest;
    const nextRootManifest = nextRoot.packageJson.zhin as ZhinPluginManifest;
    if (
      oldRoot.name !== nextRoot.name
      || oldRoot.root !== nextRoot.root
      || oldRootManifest.entry !== nextRootManifest.entry
    ) reasons.add('Root Plugin runtime contract changed');

    if (reasons.size === 0) return undefined;
    return Object.freeze({
      kind: 'process',
      changed: Object.freeze([...changed].map((source) => resolve(source))),
      reasons: Object.freeze([...reasons]),
    });
  }
}

function mountedPackages(graph: ProjectGraph): ReadonlyMap<string, ResolvedPackage> {
  const packages = new Map<string, ResolvedPackage>();
  for (const node of graphNodes(graph).values()) {
    packages.set(resolve(node.package.root), node.package);
    for (const feature of node.features) {
      packages.set(resolve(feature.package.root), feature.package);
    }
  }
  return packages;
}

function runtimeAbiChanged(previous: ResolvedPackage, next: ResolvedPackage): boolean {
  return !isDeepStrictEqual(
    runtimeAbi(previous),
    runtimeAbi(next),
  );
}

function runtimeAbi(pkg: ResolvedPackage): unknown {
  return {
    type: pkg.packageJson.type,
    main: pkg.packageJson.main,
    exports: pkg.packageJson.exports,
    imports: pkg.packageJson.imports,
  };
}
