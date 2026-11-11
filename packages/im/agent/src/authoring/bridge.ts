import type { AIHook, Skill, Tool } from '../resource-hub/types.js';
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

export function bridgeAuthoringHook(
  discovered: { runtimeName: string; definition: AuthoringHookDefinition },
): AIHook {
  return {
    name: discovered.runtimeName,
    event: discovered.definition.event,
    handler: discovered.definition.handler,
  };
}
