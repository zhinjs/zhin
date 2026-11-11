import { isDeepStrictEqual } from 'node:util';
import {
  applyConfigPatches,
  type ConfigPatch,
  type PluginId,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { ConfigComposer, type ComposedConfig } from './config-composer.js';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';
import { collapseRoots } from './topology-transaction.js';

export interface ConfigPatchPlan extends ComposedConfig {
  readonly candidate: RuntimeConfigDocument;
  readonly documentChanged: boolean;
  readonly roots: readonly PluginId[];
}

/** Validates a candidate document before deriving its minimal replacement forest. */
export class ConfigPatchPlanner {
  constructor(
    private readonly composer = new ConfigComposer(),
    private readonly previousComposer = composer,
  ) {}

  async plan(
    graph: ProjectGraph,
    current: RuntimeConfigDocument,
    patches: readonly ConfigPatch[],
    candidateGraph: ProjectGraph = graph,
    previousDocument: RuntimeConfigDocument = current,
  ): Promise<ConfigPatchPlan> {
    const previous = await this.previousComposer.compose(graph, previousDocument);
    const candidate = applyConfigPatches(current, patches);
    const next = await this.composer.compose(candidateGraph, candidate);
    const changed = indexGraph(candidateGraph)
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
