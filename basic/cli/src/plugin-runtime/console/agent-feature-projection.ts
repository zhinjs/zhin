import { commandFeatureId, isCommandIndex } from '@zhin.js/command';
import { componentFeatureId, isComponentIndex } from '@zhin.js/component';
import { isMiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';
import { isPromptSectionIndex, promptSectionFeatureId } from '@zhin.js/prompt-section';
import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { displayConsolePath } from './display-path.js';

export function listGenerationCommands(
  snapshot: RuntimeSnapshot | undefined,
  projectRoot: string,
): readonly Record<string, unknown>[] {
  const index = snapshot?.projections.get(commandFeatureId);
  if (!isCommandIndex(index)) return [];
  return index.list().map((command) => ({
    pattern: command.name,
    desc: command.description ?? '',
    plugin: displayConsolePath(command.source, projectRoot),
    parameters: command.parameters.map((parameter) => ({
      name: parameter.name,
      type: parameter.type,
      required: parameter.required,
      optional: parameter.optional ?? !parameter.required,
      rest: parameter.rest ?? false,
      description: parameter.description ?? '',
      ...(parameter.defaultValue === undefined
        ? {}
        : typeof parameter.defaultValue === 'function'
          ? { default: '<dynamic>', defaultKind: 'dynamic' }
          : { default: parameter.defaultValue, defaultKind: 'literal' }),
    })),
    aliases: command.alias ?? [],
    permissions: command.permit ?? [],
    shortcuts: command.shortcut ?? [],
  }));
}

export function listGenerationMiddlewares(
  snapshot: RuntimeSnapshot | undefined,
  projectRoot: string,
): readonly Record<string, unknown>[] {
  const index = snapshot?.projections.get(middlewareFeatureId);
  if (!isMiddlewareIndex(index)) return [];
  return index.list().map((middleware) => ({
    name: middleware.name,
    owner: String(middleware.owner),
    phase: middleware.phase,
    target: middleware.target,
    order: middleware.order,
    source: displayConsolePath(middleware.source, projectRoot),
  }));
}

export function listGenerationComponents(
  snapshot: RuntimeSnapshot | undefined,
  projectRoot: string,
): readonly Record<string, unknown>[] {
  const index = snapshot?.projections.get(componentFeatureId);
  if (!isComponentIndex(index)) return [];
  return index.list().map((component) => ({
    name: component.name,
    owner: String(component.owner),
    source: displayConsolePath(component.source, projectRoot),
  }));
}

export async function renderGenerationComponent(
  snapshot: RuntimeSnapshot | undefined,
  input: Readonly<{
    requester: string;
    name: string;
    props: unknown;
    signal: AbortSignal;
  }>,
): Promise<unknown> {
  const index = snapshot?.projections.get(componentFeatureId);
  if (!isComponentIndex(index)) throw new Error('Component Runtime 未就绪');
  return index.render(input.requester as PluginId, input.name, input.props, { signal: input.signal });
}

export function listGenerationTools(
  snapshot: RuntimeSnapshot | undefined,
  projectRoot: string,
): readonly Record<string, unknown>[] {
  const tools = new Map<string, Record<string, unknown>>();
  if (!snapshot) return [];
  for (const [feature, projection] of snapshot.projections) {
    if (!String(feature).includes('tool') || !isToolIndexLike(projection)) continue;
    for (const tool of projection.list()) {
      if (tool.hidden) continue;
      tools.set(tool.name, {
        name: tool.name,
        source: displayConsolePath(tool.source, projectRoot),
        description: tool.description ?? '',
      });
    }
  }
  return [...tools.values()];
}

/** Content-free Prompt Section catalog; prompt text never crosses this seam. */
export function listGenerationPromptSections(
  snapshot: RuntimeSnapshot | undefined,
  projectRoot: string,
): readonly Readonly<Record<string, unknown>>[] {
  const projection = snapshot?.projections.get(promptSectionFeatureId);
  if (!isPromptSectionIndex(projection)) return [];
  return Object.freeze(projection.list().map((section) => Object.freeze({
    name: section.name,
    qualifiedName: section.qualifiedName,
    title: section.title,
    owner: String(section.owner),
    layer: section.layer,
    order: section.order,
    retention: section.retention,
    ...(section.maxChars === undefined ? {} : { maxChars: section.maxChars }),
    profiles: [...section.profiles],
    ...(section.platforms ? { platforms: [...section.platforms] } : {}),
    source: displayConsolePath(section.source, projectRoot),
    generation: section.generation,
    contentChars: section.content.length,
  })));
}

function isToolIndexLike(value: unknown): value is {
  list(): { name: string; description?: string; source: string; hidden?: boolean }[];
} {
  return !!value && typeof value === 'object'
    && typeof (value as { list?: unknown }).list === 'function';
}
