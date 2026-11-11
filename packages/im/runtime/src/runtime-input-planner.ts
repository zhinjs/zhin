import { isDeepStrictEqual } from 'node:util';
import {
  rootPluginId,
  type PluginId,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { ConfigComposer, HOST_CONFIG_KEYS, type ComposedConfig } from './config-composer.js';
import {
  createEnvStore,
  type EnvironmentLayers,
} from './environment-store.js';
import type { RuntimeEnvironment } from './environment.js';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';
import { collapseRoots } from './topology-transaction.js';

export interface RuntimeInputPlan {
  readonly composed: ComposedConfig;
  readonly roots: readonly PluginId[];
  readonly hostKeys: readonly string[];
  readonly environmentChanged: boolean;
}

/** Classifies config/environment changes by their actual expanded runtime projection. */
export class RuntimeInputPlanner {
  constructor(
    private readonly composer = new ConfigComposer(),
    private readonly previousComposer = composer,
  ) {}

  async plan(options: {
    readonly graph: ProjectGraph;
    readonly nextGraph?: ProjectGraph;
    readonly environment: RuntimeEnvironment;
    readonly previousDocument: RuntimeConfigDocument;
    readonly nextDocument: RuntimeConfigDocument;
    readonly previousEnvironment: EnvironmentLayers;
    readonly nextEnvironment: EnvironmentLayers;
    /** Already validated in this control transaction; never a cross-transaction cache. */
    readonly composed?: ComposedConfig;
    readonly committed?: Readonly<{
      expandedDocument: RuntimeConfigDocument;
      expandedViews: ReadonlyMap<PluginId, unknown>;
    }>;
  }): Promise<RuntimeInputPlan> {
    const previous = options.committed ? undefined : await this.previousComposer.compose(options.graph, options.previousDocument);
    const nextGraph = options.nextGraph ?? options.graph;
    const next = options.composed ?? await this.composer.compose(nextGraph, options.nextDocument);
    const environmentChanged = !isDeepStrictEqual(
      options.previousEnvironment,
      options.nextEnvironment,
    );
    const hostKeys = HOST_CONFIG_KEYS.filter((key) => !isDeepStrictEqual(
      options.committed ? options.committed.expandedDocument[key]
        : expandHostValue(previous!.document[key], options.environment, options.previousEnvironment),
      expandHostValue(next.document[key], options.environment, options.nextEnvironment),
    ));
    const changed = indexGraph(nextGraph)
      .filter((node) => !isDeepStrictEqual(
        options.committed ? options.committed.expandedViews.get(node.id) : expandPluginView(
          node.id,
          previous!.views.get(node.id),
          options.environment,
          options.previousEnvironment,
        ),
        expandPluginView(
          node.id,
          next.views.get(node.id),
          options.environment,
          options.nextEnvironment,
        ),
      ))
      .map((node) => node.id);

    // EnvStore is itself a public Plugin resource. A changed global layer can
    // affect direct env.get()/parse() consumers even when no ${VAR} occurs in
    // config, so conservatively rebuild the Root generation when no narrower
    // config-derived owner proves the impact.
    const roots = environmentChanged ? [rootPluginId()] : collapseRoots(changed);
    return Object.freeze({
      composed: next,
      roots: Object.freeze(roots),
      hostKeys: Object.freeze(hostKeys),
      environmentChanged,
    });
  }
}

function expandHostValue(
  value: unknown,
  environment: RuntimeEnvironment,
  layers: EnvironmentLayers,
): unknown {
  return createEnvStore(rootPluginId(), environment, layers).expandMissingAsEmpty(value);
}

function expandPluginView(
  owner: PluginId,
  value: unknown,
  environment: RuntimeEnvironment,
  layers: EnvironmentLayers,
): unknown {
  return createEnvStore(owner, environment, layers).expandMissingAsEmpty(value);
}

function indexGraph(graph: ProjectGraph): readonly PluginGraphNode[] {
  const result: PluginGraphNode[] = [];
  const visit = (node: PluginGraphNode): void => {
    result.push(node);
    for (const child of node.children) visit(child);
  };
  visit(graph.root);
  return result;
}
