import type { Message } from '@zhin.js/core';
import type { Skill, Tool, McpServerEntry } from '../orchestrator/types.js';
import {
  type AuthoringSkillDefinition,
  type AuthoringConnectionDefinition,
  type AuthoringHookDefinition,
  type BridgedToolFromAuthoring,
  type DiscoveredAuthoringTool,
  AUTHORING_KIND,
} from './types.js';
import { parseConfigWithZodSchema, parseWithZodSchema, zodObjectToParameters } from './zod-schema.js';

export function namespaceAuthoringName(pluginName: string, slotName: string, bare = false): string {
  if (bare) return slotName;
  const safePlugin = pluginName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSlot = slotName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safePlugin}_${safeSlot}`;
}

export function slotNameFromFile(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base.replace(/\.(ts|js|md)$/i, '');
}

export function slotNameFromDir(dirPath: string): string {
  return dirPath.split(/[/\\]/).filter(Boolean).pop() ?? dirPath;
}

export function bridgeAuthoringTool(
  discovered: DiscoveredAuthoringTool,
): BridgedToolFromAuthoring {
  const { definition, runtimeName, pluginName, filePath } = discovered;
  const parameters = zodObjectToParameters(definition.inputSchema);
  const ctxBase = { pluginName, runtimeName, filePath };

  const execute = async (args: Record<string, unknown>, _message?: Message) => {
    const parsed = parseWithZodSchema<Record<string, unknown>>(definition.inputSchema, args);
    if (!parsed.ok) return `Error: ${parsed.error}`;
    return definition.execute(parsed.data, ctxBase);
  };

  return {
    name: runtimeName,
    description: definition.description,
    parameters,
    execute,
    platforms: definition.platforms,
    scopes: definition.scopes,
    permissions: definition.permissions,
    tags: definition.tags,
    keywords: definition.keywords,
    hidden: definition.hidden,
    source: pluginName,
    filePath,
  };
}

export function bridgeAuthoringToolToOrchestratorTool(bridged: BridgedToolFromAuthoring): Tool {
  return {
    name: bridged.name,
    description: bridged.description,
    parameters: bridged.parameters,
    execute: bridged.execute,
    platforms: bridged.platforms,
    scopes: bridged.scopes,
    permissions: bridged.permissions,
    tags: bridged.tags,
    keywords: bridged.keywords,
    hidden: bridged.hidden,
    source: bridged.source,
  };
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

export function bridgeAuthoringConnection(
  discovered: {
    runtimeName: string;
    slotName: string;
    pluginName: string;
    definition: AuthoringConnectionDefinition;
  },
  configValue: unknown,
): { ok: true; entry: McpServerEntry } | { ok: false; error: string } {
  const parsed = parseConfigWithZodSchema(discovered.definition.configSchema, configValue);
  if (!parsed.ok) {
    return { ok: false, error: `Connection "${discovered.slotName}": ${parsed.error}` };
  }
  const built = discovered.definition.buildEntry(parsed.data);
  const entry: McpServerEntry = {
    name: discovered.runtimeName,
    transport: discovered.definition.transport,
    url: built.url ?? discovered.definition.url,
    command: built.command ?? discovered.definition.command,
    args: built.args ?? discovered.definition.args,
    env: built.env,
    headers: { ...discovered.definition.headers, ...built.headers },
  };
  return { ok: true, entry };
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
