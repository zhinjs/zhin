import { resolve } from 'node:path';
import {
  DisposeStack,
  Scope,
  rootPluginId,
  type ConfigView,
  type Dispose,
  type PluginDefinition,
  type PluginId,
  type PluginInstanceView,
  type PluginNodeSnapshot,
  type TokenId,
} from '@zhin.js/next-kernel';
import { runtimeEnvironmentToken, type RuntimeEnvironment } from './environment.js';
import type { ZhinPluginManifest } from './manifest.js';
import type { ModuleRuntime } from './module-runtime.js';
import type { PluginGraphNode } from './project-graph.js';

export type PluginConfigResolver = (node: PluginGraphNode) => unknown;

export interface RootResourceContext {
  readonly resources: Scope;
  readonly lifecycle: DisposeStack;
}

export type RootResourceInstaller = (
  context: RootResourceContext,
) => void | Promise<void>;

export interface PluginAssemblySeed {
  readonly scopes: ReadonlyMap<PluginId, Scope>;
  readonly tree: ReadonlyMap<PluginId, PluginNodeSnapshot>;
  readonly config: ReadonlyMap<PluginId, unknown>;
  readonly resources: ReadonlyMap<PluginId, ReadonlyMap<TokenId, unknown>>;
}

/** Assembles Plugin setup into mutable shadow maps without publishing them. */
export class PluginScopeAssembler {
  readonly scopes: Map<PluginId, Scope>;
  readonly tree: Map<PluginId, PluginNodeSnapshot>;
  readonly config: Map<PluginId, unknown>;
  readonly resources: Map<PluginId, ReadonlyMap<TokenId, unknown>>;
  readonly #created: PluginId[] = [];

  constructor(
    private readonly modules: ModuleRuntime,
    private readonly configResolver: PluginConfigResolver,
    private readonly environment: RuntimeEnvironment,
    private readonly installResources?: RootResourceInstaller,
    seed?: PluginAssemblySeed,
  ) {
    this.scopes = new Map(seed?.scopes);
    this.tree = new Map(seed?.tree);
    this.config = new Map(seed?.config);
    this.resources = new Map(seed?.resources);
  }

  removeSubtrees(roots: readonly PluginId[]): void {
    // Seeded Scopes belong to a committed generation. Removing a map entry
    // only prepares the shadow view; GenerationAssets owns eventual disposal.
    for (const owner of [...this.scopes.keys()]) {
      if (!roots.some((root) => isWithin(owner, root))) continue;
      this.scopes.delete(owner);
      this.tree.delete(owner);
      this.config.delete(owner);
      this.resources.delete(owner);
    }
  }

  async setupTree(node: PluginGraphNode): Promise<void> {
    const manifest = node.package.packageJson.zhin as ZhinPluginManifest;
    if (manifest.runtime === 'isolated') {
      throw new Error(`Isolated Plugin runtime is not implemented: ${node.package.name}`);
    }
    const module = await this.modules.load<ModuleNamespace>(
      resolve(node.package.root, manifest.entry),
    );
    const definition = module.default as PluginDefinition | undefined;
    if (!definition || typeof definition.name !== 'string') {
      throw new TypeError(`${node.package.name} does not default-export a Plugin definition`);
    }

    const parentScope = node.parent ? this.scopes.get(node.parent) : undefined;
    if (node.parent && !parentScope) throw new Error(`Missing parent scope for ${node.id}`);
    const scope = new Scope(node.id, parentScope);
    this.scopes.set(node.id, scope);
    this.#created.push(node.id);

    if (!node.parent) {
      scope.provide(runtimeEnvironmentToken, this.environment);
      await this.installResources?.({ resources: scope, lifecycle: scope.disposers });
    }

    for (const token of definition.requires ?? []) {
      if (!scope.has(token)) {
        throw new Error(`Missing resource ${token.id} for Plugin ${node.id}`);
      }
    }

    const config = Object.freeze(this.configResolver(node) ?? {});
    const view: ConfigView<unknown> = { get: () => config };
    const plugin: PluginInstanceView = Object.freeze({
      id: node.id,
      instanceKey: node.instanceKey,
      parent: node.parent,
      root: rootPluginId(),
      role: node.parent ? 'child' : 'root',
    });
    const returned = await definition.setup?.({
      plugin,
      config: view,
      resources: scope,
      lifecycle: scope.disposers,
    });
    if (returned) scope.disposers.add(returned);
    scope.seal();

    this.tree.set(node.id, Object.freeze({
      id: node.id,
      instanceKey: node.instanceKey,
      packageName: node.package.name,
      packageRoot: node.package.root,
      parent: node.parent,
      children: Object.freeze(node.children.map((child) => child.id)),
      metadata: definition.metadata,
    }));
    this.config.set(node.id, config);
    this.resources.set(node.id, scope.snapshot());

    for (const child of node.children) await this.setupTree(child);
  }

  createdScopeDisposers(): readonly (readonly [PluginId, Dispose])[] {
    return this.#created.map((owner) => {
      const scope = this.scopes.get(owner);
      if (!scope) throw new Error(`Missing created Scope: ${owner}`);
      return [owner, () => scope.disposers.dispose()] as const;
    });
  }
}

interface ModuleNamespace {
  readonly default?: unknown;
}

function isWithin(plugin: PluginId, root: PluginId): boolean {
  return plugin === root || plugin.startsWith(`${root}/`);
}
