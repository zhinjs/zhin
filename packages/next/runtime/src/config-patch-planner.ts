import { isDeepStrictEqual } from 'node:util';
import { rootPluginId, type PluginId } from '@zhin.js/next-kernel';
import {
  ConfigComposer,
  type ComposedConfig,
  type RuntimeConfigDocument,
} from './config-composer.js';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';

export type ConfigPatch =
  | {
      readonly op: 'set';
      readonly path: readonly string[];
      readonly value: unknown;
    }
  | {
      readonly op: 'remove';
      readonly path: readonly string[];
    };

export interface ConfigPatchPlan extends ComposedConfig {
  readonly roots: readonly PluginId[];
}

export class ConfigPatchPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigPatchPathError';
  }
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
    let candidate = structuredClone(previous.document) as Record<string, unknown>;
    for (const patch of patches) candidate = applyPatch(candidate, patch);
    const next = await this.composer.compose(graph, candidate);
    const changed = indexGraph(graph)
      .filter((node) => !isDeepStrictEqual(
        previous.views.get(node.id),
        next.views.get(node.id),
      ))
      .map((node) => node.id);
    return Object.freeze({ ...next, roots: Object.freeze(collapseRoots(changed)) });
  }
}

function applyPatch(
  document: Record<string, unknown>,
  patch: ConfigPatch,
): Record<string, unknown> {
  assertPath(patch.path);
  if (patch.path.length === 0) {
    if (patch.op === 'remove') {
      throw new ConfigPatchPathError('The config document root cannot be removed');
    }
    return cloneDocument(patch.value);
  }
  if (patch.op === 'set') setValue(document, patch.path, structuredClone(patch.value));
  else removeValue(document, patch.path);
  return document;
}

function setValue(
  document: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let target = document;
  for (const [index, segment] of path.slice(0, -1).entries()) {
    const existing = target[segment];
    if (existing === undefined) {
      const created: Record<string, unknown> = {};
      target[segment] = created;
      target = created;
    } else {
      target = requireRecord(existing, path.slice(0, index + 1));
    }
  }
  target[lastSegment(path)] = value;
}

function removeValue(document: Record<string, unknown>, path: readonly string[]): void {
  let target = document;
  for (const [index, segment] of path.slice(0, -1).entries()) {
    const existing = target[segment];
    if (existing === undefined) return;
    target = requireRecord(existing, path.slice(0, index + 1));
  }
  delete target[lastSegment(path)];
}

function cloneDocument(value: unknown): Record<string, unknown> {
  return requireRecord(structuredClone(value), []);
}

function requireRecord(value: unknown, path: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigPatchPathError(`Config path ${pointer(path)} is not an object`);
  }
  return value as Record<string, unknown>;
}

function assertPath(path: readonly string[]): void {
  for (const segment of path) {
    if (!segment || segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
      throw new ConfigPatchPathError(`Unsafe config path segment: ${segment || '<empty>'}`);
    }
  }
}

function lastSegment(path: readonly string[]): string {
  const segment = path[path.length - 1];
  if (!segment) throw new ConfigPatchPathError('Config patch path is empty');
  return segment;
}

function pointer(path: readonly string[]): string {
  if (path.length === 0) return '/';
  return `/${path.map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
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
