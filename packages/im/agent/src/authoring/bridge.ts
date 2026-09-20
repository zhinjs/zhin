import type { Skill, Tool } from '../resource-hub/types.js';
import {
  type AuthoringSkillDefinition,
  type AuthoringHookDefinition,
  AUTHORING_KIND,
} from './types.js';

export function namespaceAuthoringName(pluginName: string, slotName: string, bare = false): string {
  if (bare) return slotName;
  const safePlugin = pluginName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSlot = slotName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safePlugin}_${safeSlot}`;
}

export function slotNameFromFile(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base.replace(/^\$/u, '').replace(/\.(ts|js|md)$/i, '');
}

export function slotNameFromDir(dirPath: string): string {
  return dirPath.split(/[/\\]/).filter(Boolean).pop() ?? dirPath;
}

export function bridgeAuthoringSkill(
  discovered: { runtimeName: string; pluginName: string; filePath: string; definition: AuthoringSkillDefinition },
  tools: Tool[],
): Skill {
  const toolNames = discovered.definition.toolNames ?? [];
  const boundTools = toolNames.length
    ? tools.filter((t) => toolNames.includes(t.name))
    : [];
  return {
    name: discovered.runtimeName,
    description: discovered.definition.description,
    tools: boundTools,
    platforms: discovered.definition.platforms,
    keywords: discovered.definition.keywords,
    tags: discovered.definition.tags,
    pluginName: discovered.pluginName,
    filePath: discovered.filePath,
    always: discovered.definition.always,
  };
}

export function bridgeAuthoringHook(
  discovered: { runtimeName: string; definition: AuthoringHookDefinition },
) {
  return {
    name: discovered.runtimeName,
    event: discovered.definition.event,
    handler: discovered.definition.handler,
  };
}

export function skillFromMarkdownFile(
  description: string,
  body: string,
  options?: { keywords?: string[]; tags?: string[]; toolNames?: string[]; always?: boolean },
): AuthoringSkillDefinition {
  return {
    [AUTHORING_KIND]: 'skill',
    description,
    content: body,
    keywords: options?.keywords,
    tags: options?.tags,
    toolNames: options?.toolNames,
    always: options?.always,
  };
}
