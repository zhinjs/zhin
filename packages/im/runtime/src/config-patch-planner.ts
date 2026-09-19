import { isDeepStrictEqual } from 'node:util';
import {
  applyConfigPatches,
  rootPluginId,
  type ConfigPatch,
  type PluginId,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { ConfigComposer, type ComposedConfig } from './config-composer.js';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';

export interface ConfigPatchPlan extends ComposedConfig {
  readonly candidate: RuntimeConfigDocument;
  readonly documentChanged: boolean;
  readonly roots: readonly PluginId[];
}

/** Validates a candidate document before deriving its minimal replacement forest. */
export class ConfigPatchPlanner {
  constructor(private readonly composer = new ConfigComposer()) {}

  async plan(
    graph: ProjectGraph,
    current: RuntimeConfigDocument,
    patches: readonly ConfigPatch[],
  ): Promise<ConfigPatchPlan> {
    const previous = await this.composer.compose(graph, current);
    const candidate = applyConfigPatches(current, patches);
    const next = await this.composer.compose(graph, candidate);
    const changed = indexGraph(graph)
      .filter((node) => !isDeepStrictEqual(
        previous.views.get(node.id),
        next.views.get(node.id),
      ))
      .map((node) => node.id);
    return Object.freeze({
      ...next,
      candidate,
      documentChanged: !isDeepStrictEqual(current, candidate),
      roots: Object.freeze(collapseRoots(changed)),
    });
  }
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

function collapseRoots(plugins: readonly PluginId[]): readonly PluginId[] {
  if (plugins.includes(rootPluginId())) return [rootPluginId()];
  const selected = new Set(plugins);
  return plugins.filter((plugin) => {
    let parent = parentPlugin(plugin);
    while (parent) {
      if (selected.has(parent)) return false;
      parent = parentPlugin(parent);
    }
    return true;
  });
}

function parentPlugin(plugin: PluginId): PluginId | undefined {
  const separator = plugin.lastIndexOf('/');
  return separator < 0 ? undefined : plugin.slice(0, separator) as PluginId;
}
